'use client'

import { FieldError, Input, Label, Tag, TagGroup, TextField } from '@heroui/react'
import type { ComponentProps, Key } from 'react'
import {
  addParticipants,
  hasVisibleText,
  participantKey,
  validateParticipant,
} from '@/lib/meeting-form'

export interface ParticipantsFieldProps {
  participants: string[]
  onParticipantsChange: (participants: string[]) => void
  // текст, ещё не ставший тегом: при отправке формы он тоже уходит в участники
  value: string
  onValueChange: (value: string) => void
  error: string | null
  onErrorChange: (error: string | null) => void
  // во время запроса список не меняется: при ошибке API в окне виден ровно отправленный
  isDisabled?: boolean
}

type TextFieldKeyDown = NonNullable<ComponentProps<typeof TextField>['onKeyDown']>

// Поле «Участники»: имя становится тегом по Enter или запятой (вставка «Анна, Борис, Вера» — теги
// до последней запятой, остаток в поле), тег удаляется крестиком или Backspace в пустом поле.
// Повтор, некорректное имя и 51-й участник не добавляются, причина — у поля, ввод остаётся
export function ParticipantsField({
  participants,
  onParticipantsChange,
  value,
  onValueChange,
  error,
  onErrorChange,
  isDisabled = false,
}: ParticipantsFieldProps) {
  // Режем ввод на имена (запятые до последней — границы тегов, остаток остаётся в поле). Повтор уже
  // добавленного пропускается, как при отправке, а не блокирует весь вставленный список.
  // При ошибке неподошедшее имя и всё после него остаются в поле, чтобы их можно было исправить
  const commit = (text: string) => {
    const chunks = text.split(',')
    const tail = chunks.pop() ?? ''
    const result = addParticipants(chunks, participants, { skipDuplicates: true })
    if (result.list.length !== participants.length) onParticipantsChange(result.list)
    onValueChange(result.error ? [...chunks.slice(result.failedAt), tail].join(',') : tail)
    onErrorChange(result.error)
  }

  const onChange = (next: string) => {
    // Разбираем только на новой запятой (набрана или вставлена). Иначе правка остатка с запятыми
    // после ошибки (укорачивание длинного имени по символу) сохраняла бы имя посреди правки,
    // а курсор прыгал бы в конец поля. Такой остаток разберут Enter и отправка формы
    if (next.split(',').length > value.split(',').length) {
      commit(next)
      return
    }
    onValueChange(next)
    onErrorChange(null)
  }

  const onKeyDown: TextFieldKeyDown = (event) => {
    // Enter во время набора через IME подтверждает вариант, а не добавляет тег. Safari шлёт
    // `compositionend` раньше `keydown`, и у подтверждающего Enter `isComposing` уже false —
    // такой keydown узнаётся по keyCode 229
    if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return
    if (event.key === 'Enter') {
      // Enter добавляет тег и не отправляет форму
      event.preventDefault()
      if (!hasVisibleText(value)) return
      // остаток вставки с запятыми — несколько имён, а не одно имя с запятыми
      if (value.includes(',')) {
        commit(`${value},`)
        return
      }
      const error = validateParticipant(value, participants)
      if (error) {
        onErrorChange(error)
        return
      }
      onParticipantsChange([...participants, value.trim()])
      onValueChange('')
      onErrorChange(null)
    } else if (
      event.key === 'Backspace' &&
      value === '' &&
      participants.length > 0 &&
      !isDisabled
    ) {
      onParticipantsChange(participants.slice(0, -1))
      onErrorChange(null)
    } else {
      // React Aria с заданным onKeyDown сам останавливает всплытие: без этого Esc в поле не дошёл
      // бы до окна и не закрыл его
      event.continuePropagation()
    }
  }

  // Удаление тега может снять только повтор или лимит: ошибка ввода пересчитывается по новому списку
  const onRemove = (keys: Set<Key>) => {
    if (isDisabled) return
    const next = participants.filter((name) => !keys.has(participantKey(name)))
    onParticipantsChange(next)
    if (error !== null) {
      onErrorChange(hasVisibleText(value) ? validateParticipant(value, next) : null)
    }
  }

  return (
    <div className="flex flex-col gap-2">
      {/* validationBehavior="aria": ошибка ввода не блокирует отправку формы браузером — при
          отправке ввод проверяет окно (повтор уже добавленного там не ошибка) */}
      <TextField
        fullWidth
        variant="secondary"
        value={value}
        onChange={onChange}
        onKeyDown={onKeyDown}
        isInvalid={error !== null}
        isDisabled={isDisabled}
        validationBehavior="aria"
      >
        <Label>Участники</Label>
        <Input placeholder="Имя, затем Enter или запятая" />
        {/* место под ошибку занято всегда, чтобы кнопки не прыгали из-под курсора; live-регион —
            иначе скринридер не скажет, почему тег по Enter не появился */}
        <div className="min-h-5" aria-live="polite">
          <FieldError>{error}</FieldError>
        </div>
      </TextField>

      {participants.length > 0 && (
        <TagGroup
          aria-label="Добавленные участники"
          onRemove={onRemove}
          // у TagGroup нет isDisabled: блокируем все теги, крестики тоже становятся недоступны
          disabledKeys={isDisabled ? participants.map(participantKey) : undefined}
        >
          <TagGroup.List className="max-h-40 overflow-y-auto">
            {participants.map((name) => (
              <Tag key={participantKey(name)} id={participantKey(name)} textValue={name}>
                {name}
                {/* пустой aria-labelledby: иначе React Aria добавит к подписи текст тега
                    («Удалить Анна Анна») */}
                <Tag.RemoveButton aria-label={`Удалить ${name}`} aria-labelledby="" />
              </Tag>
            ))}
          </TagGroup.List>
        </TagGroup>
      )}
    </div>
  )
}
