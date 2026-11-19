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
  (message: string): FieldErrorRender =>
  ({ validationDetails, validationErrors }) =>
    validationDetails.valueMissing ? message : validationErrors.join(' ')

// Окно создания встречи с кнопкой «Создать встречу»: название, дата и время по времени браузера,
// участники тегами; в API уходит момент в UTC и участники (вместе с невписанным в тег именем),
// после успеха — переход на страницу встречи
export function CreateMeetingDialog() {
  const router = useRouter()
  const [isOpen, setIsOpen] = useState(false)
  const [date, setDate] = useState<CalendarDate | null>(null)
  const [time, setTime] = useState<Time | null>(null)
  const [participants, setParticipants] = useState<string[]>([])
  const [participantInput, setParticipantInput] = useState('')
  const [participantError, setParticipantError] = useState<string | null>(null)
  // причины ошибки API: у 400 валидации их несколько, по одной на поле
  const [error, setError] = useState<string[] | null>(null)
  // pending держится до конца перехода на страницу встречи; ref отсекает повторную отправку сразу
  const [pending, startTransition] = useTransition()
  const submitting = useRef(false)

  // Значения по умолчанию считаются при каждом открытии: окно могли открыть через час после загрузки
  const open = () => {
    const start = defaultMeetingStart()
    setDate(parseDate(start.date))
    setTime(parseTime(start.time))
    setParticipants([])
    setParticipantInput('')
    setParticipantError(null)
    setError(null)
    setIsOpen(true)
  }

  const onOpenChange = (next: boolean) => {
    // во время запроса окно не закрывается
    if (!next && submitting.current) return
    setIsOpen(next)
  }

  const onSubmit = (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (submitting.current || !date || !time) return
    const title = String(new FormData(event.currentTarget).get('title'))
    // поле уже не пускает отправку с ошибкой; проверка здесь — страховка, чтобы запрос не ушёл
    if (validateMeetingTitle(title)) return
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
    setError(null)
    startTransition(async () => {
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
        // Обновления после await в React 19 не входят в переход сами: без вложенного
        // startTransition окно закрылось бы раньше, чем откроется страница встречи
        startTransition(() => {
          router.push(`/meetings/${encodeURIComponent(meeting.id)}`)
          // Next 16 скрывает главную, а не размонтирует, и при возврате показал бы её прежние
          // данные. refresh сразу после push берёт этот переход на себя и сбрасывает кэш скрытых
          // страниц целиком (`invalidateBfCache()` в `refresh-reducer` Next 16.4), а не только
          // текущей: главная перезапросит счётчик и «Последние встречи»
          router.refresh()
          setIsOpen(false)
        })
        submitting.current = false
      } catch (e) {
        submitting.current = false
        if (e instanceof ApiError && e.status === 401) {
          router.replace('/login')
          return
        }
        setError(
          e instanceof ApiError
            ? e.messages
            : [e instanceof Error ? e.message : 'Что-то пошло не так'],
        )
      }
    })
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

                <div className="flex items-start gap-3">
                  <DateField
                    fullWidth
                    name="date"
                    value={date}
                    onChange={setDate}
                    granularity="day"
                    isRequired
                  >
                    <Label>Дата</Label>
                    <DateField.Group variant="secondary">
                      <DateField.Input>
                        {(segment) => <DateField.Segment segment={segment} />}
                      </DateField.Input>
                    </DateField.Group>
                    <div className="min-h-5">
                      <FieldError>{requiredMessage('Укажите дату')}</FieldError>
                    </div>
                  </DateField>

                  <TimeField
                    fullWidth
                    name="time"
                    value={time}
                    onChange={setTime}
                    hourCycle={24}
                    granularity="minute"
                    isRequired
                  >
                    <Label>Время</Label>
                    <TimeField.Group variant="secondary">
                      <TimeField.Input>
                        {(segment) => <TimeField.Segment segment={segment} />}
                      </TimeField.Input>
                    </TimeField.Group>
                    <div className="min-h-5">
                      <FieldError>{requiredMessage('Укажите время')}</FieldError>
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
