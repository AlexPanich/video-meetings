'use client'

import { Plus } from '@gravity-ui/icons'
import {
  Alert,
  Button,
  DateField,
  FieldError,
  Form,
  Input,
  Label,
  Modal,
  Spinner,
  TextField,
  TimeField,
} from '@heroui/react'
import { type CalendarDate, type Time, parseDate, parseTime } from '@internationalized/date'
import { useRouter } from 'next/navigation'
import { type ComponentProps, type SyntheticEvent, useRef, useState, useTransition } from 'react'
import { ParticipantsField } from '@/components/participants-field'
import { ApiError, createMeeting } from '@/lib/api'
import {
  addParticipants,
  defaultMeetingStart,
  localDateTimeToIso,
  validateMeetingTitle,
} from '@/lib/meeting-form'

// Текст ошибки поля даты или времени: вместо сообщения браузера о пустом обязательном поле — своё
// (React Aria не вызывает `validate` для null, поэтому пустое поле ловит только `isRequired`)
type FieldErrorRender = Extract<
  ComponentProps<typeof FieldError>['children'],
  (v: never) => unknown
>
const requiredMessage =
  (message: string, incomplete: boolean): FieldErrorRender =>
  ({ validationDetails, validationErrors }) =>
    incomplete || validationDetails.valueMissing ? message : validationErrors.join(' ')

// Частично стёртое поле даты или времени: React Aria держит неполный ввод только в отображении,
// `onChange` не вызывает и оставляет прежнее значение (null — лишь когда стёрты все сегменты).
// Пустой сегмент помечается `data-placeholder`
const hasEmptySegment = (form: HTMLFormElement, field: 'date' | 'time') =>
  form.querySelector(`[data-field="${field}"] [data-placeholder]`) !== null

// Окно создания встречи с кнопкой «Создать встречу»: название, дата и время по времени браузера,
// участники тегами; в API уходит момент в UTC и участники (вместе с невписанным в тег именем),
// после успеха — переход на страницу встречи
export function CreateMeetingDialog() {
  const router = useRouter()
  const [isOpen, setIsOpen] = useState(false)
  const [date, setDate] = useState<CalendarDate | null>(null)
  const [time, setTime] = useState<Time | null>(null)
  const [dateIncomplete, setDateIncomplete] = useState(false)
  const [timeIncomplete, setTimeIncomplete] = useState(false)
  const [participants, setParticipants] = useState<string[]>([])
  const [participantInput, setParticipantInput] = useState('')
  const [participantError, setParticipantError] = useState<string | null>(null)
  // причины ошибки API: у 400 валидации их несколько, по одной на поле
  const [error, setError] = useState<string[] | null>(null)
  // Запрос — обычное состояние, а не async-переход: React 19 связывает все незавершённые
  // async-переходы, и чужой зависший запрос держал бы «Создать» в загрузке и после ошибки.
  // Переход на страницу встречи — синхронный startTransition, его pending держит загрузку до конца
  // перехода; ref отсекает повторную отправку сразу, до перерисовки
  const [requesting, setRequesting] = useState(false)
  const [navigating, startTransition] = useTransition()
  const pending = requesting || navigating
  const submitting = useRef(false)

  // Значения по умолчанию считаются при каждом открытии: окно могли открыть через час после загрузки
  const open = () => {
    const start = defaultMeetingStart()
    setDate(parseDate(start.date))
    setTime(parseTime(start.time))
    setDateIncomplete(false)
    setTimeIncomplete(false)
    // после 401 загрузка остаётся до ухода на вход; Next 16 скрывает главную, а не размонтирует,
    // поэтому при возврате окно открывается уже без неё (закрытое окно запросов не ведёт)
    setRequesting(false)
    submitting.current = false
    setParticipants([])
    setParticipantInput('')
    setParticipantError(null)
    setError(null)
    setIsOpen(true)
  }

  const onOpenChange = (next: boolean) => {
    // во время запроса и перехода на страницу встречи окно не закрывается
    if (!next && (submitting.current || pending)) return
    setIsOpen(next)
  }

  // Флаг неполного ввода снимается не только в onChange: дозаполненный сегмент с прежним значением
  // onChange не вызывает, а поле с `isInvalid` браузер не даёт отправить, и onSubmit не перепроверит
  const recheckSegments = (event: SyntheticEvent<HTMLElement>) => {
    const form = event.currentTarget.closest('form')
    if (!form) return
    if (dateIncomplete) setDateIncomplete(hasEmptySegment(form, 'date'))
    if (timeIncomplete) setTimeIncomplete(hasEmptySegment(form, 'time'))
  }

  const onSubmit = (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (submitting.current || pending || !date || !time) return
    const form = event.currentTarget
    const title = String(new FormData(form).get('title'))
    const incompleteDate = hasEmptySegment(form, 'date')
    const incompleteTime = hasEmptySegment(form, 'time')
    setDateIncomplete(incompleteDate)
    setTimeIncomplete(incompleteTime)
    // поле уже не пускает отправку с ошибкой; проверка здесь — страховка, чтобы запрос не ушёл
    if (validateMeetingTitle(title)) return
    if (incompleteDate || incompleteTime) return
    // Невписанный в тег ввод тоже уходит в участники и становится тегами: так при ошибке API видно,
    // что отправлено. В нём могут остаться запятые (после ошибки при вставке списка) — режем так же,
    // как поле; повтор уже добавленного просто не дублируется, некорректное имя блокирует отправку
    const parsed = addParticipants(participantInput.split(','), participants, {
      skipDuplicates: true,
    })
    if (parsed.error) {
      setParticipants(parsed.list)
      setParticipantInput(participantInput.split(',').slice(parsed.failedAt).join(','))
      setParticipantError(parsed.error)
      return
    }
    const sentParticipants = parsed.list
    setParticipants(sentParticipants)
    setParticipantInput('')
    setParticipantError(null)
    // `CalendarDate` — `YYYY-MM-DD`, `Time` — `HH:MM:SS`
    const startsAt = localDateTimeToIso(date.toString(), time.toString())
    submitting.current = true
    setRequesting(true)
    setError(null)
    void (async () => {
      try {
        const meeting = await createMeeting({
          title: title.trim(),
          date: startsAt,
          participants: sentParticipants,
        })
        // 2xx без id (неожиданный ответ BFF) не должен вести на `/meetings/undefined`
        if (typeof meeting?.id !== 'string' || !meeting.id) {
          throw new ApiError('Что-то пошло не так', 0)
        }
        // Закрытие окна и снятие загрузки — в том же переходе, что и навигация: иначе окно
        // закрылось бы раньше, чем откроется страница встречи
        startTransition(() => {
          router.push(`/meetings/${encodeURIComponent(meeting.id)}`)
          // Next 16 скрывает главную, а не размонтирует, и при возврате показал бы её прежние
          // данные. refresh сразу после push берёт этот переход на себя и сбрасывает кэш скрытых
          // страниц целиком (`invalidateBfCache()` в `refresh-reducer` Next 16.4), а не только
          // текущей: главная перезапросит счётчик и «Последние встречи»
          router.refresh()
          setIsOpen(false)
          setRequesting(false)
        })
        submitting.current = false
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) {
          // загрузка и ref остаются до ухода на вход: форму с истёкшей сессией повторно
          // не отправить и окно не закрыть; снимает их следующее открытие окна
          router.replace('/login')
          return
        }
        submitting.current = false
        setRequesting(false)
        setError(
          e instanceof ApiError
            ? e.messages
            : [e instanceof Error ? e.message : 'Что-то пошло не так'],
        )
      }
    })()
  }

  return (
    <>
      <Button onPress={open}>
        <Plus />
        Создать встречу
      </Button>

      <Modal.Backdrop isOpen={isOpen} onOpenChange={onOpenChange}>
        <Modal.Container>
          <Modal.Dialog className="sm:max-w-[440px]">
            <Modal.Header>
              <Modal.Heading>Новая встреча</Modal.Heading>
            </Modal.Header>
            <Form className="flex flex-col gap-4" onSubmit={onSubmit}>
              <Modal.Body className="flex flex-col gap-4">
                {error && (
                  <Alert status="danger" role="alert">
                    <Alert.Indicator />
                    <Alert.Content>
                      <Alert.Description>
                        {error.map((message, index) => (
                          <span key={index} className="block">
                            {message}
                          </span>
                        ))}
                      </Alert.Description>
                    </Alert.Content>
                  </Alert>
                )}

                <TextField
                  fullWidth
                  autoFocus
                  variant="secondary"
                  name="title"
                  validate={validateMeetingTitle}
                >
                  <Label>Название</Label>
                  <Input placeholder="Например, планёрка команды" />
                  {/* место под ошибку занято всегда, чтобы кнопки не прыгали из-под курсора */}
                  <div className="min-h-5">
                    <FieldError />
                  </div>
                </TextField>

                <div
                  className="flex items-start gap-3"
                  onKeyUp={recheckSegments}
                  onBlur={recheckSegments}
                >
                  <DateField
                    fullWidth
                    name="date"
                    value={date}
                    onChange={(next) => {
                      setDate(next)
                      setDateIncomplete(false)
                    }}
                    granularity="day"
                    isRequired
                    isInvalid={dateIncomplete || undefined}
                  >
                    <Label>Дата</Label>
                    <DateField.Group variant="secondary" data-field="date">
                      <DateField.Input>
                        {(segment) => <DateField.Segment segment={segment} />}
                      </DateField.Input>
                    </DateField.Group>
                    <div className="min-h-5">
                      <FieldError>{requiredMessage('Укажите дату', dateIncomplete)}</FieldError>
                    </div>
                  </DateField>

                  <TimeField
                    fullWidth
                    name="time"
                    value={time}
                    onChange={(next) => {
                      setTime(next)
                      setTimeIncomplete(false)
                    }}
                    hourCycle={24}
                    granularity="minute"
                    isRequired
                    isInvalid={timeIncomplete || undefined}
                  >
                    <Label>Время</Label>
                    <TimeField.Group variant="secondary" data-field="time">
                      <TimeField.Input>
                        {(segment) => <TimeField.Segment segment={segment} />}
                      </TimeField.Input>
                    </TimeField.Group>
                    <div className="min-h-5">
                      <FieldError>{requiredMessage('Укажите время', timeIncomplete)}</FieldError>
                    </div>
                  </TimeField>
                </div>

                <ParticipantsField
                  participants={participants}
                  onParticipantsChange={setParticipants}
                  value={participantInput}
                  onValueChange={setParticipantInput}
                  error={participantError}
                  onErrorChange={setParticipantError}
                  isDisabled={pending}
                />
              </Modal.Body>

              <Modal.Footer>
                <Button variant="tertiary" isDisabled={pending} onPress={() => onOpenChange(false)}>
                  Отмена
                </Button>
                <Button type="submit" isPending={pending}>
                  {pending ? <Spinner aria-label="Загрузка" color="current" size="sm" /> : null}
                  Создать
                </Button>
              </Modal.Footer>
            </Form>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </>
  )
}
