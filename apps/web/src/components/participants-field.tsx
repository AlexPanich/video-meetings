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
}: ParticipantsFieldProps) {
  const onChange = (next: string) => {
    if (!next.includes(',')) {
      onValueChange(next)
      onErrorChange(null)
      return
    }
    const chunks = next.split(',')
    const tail = chunks.pop() ?? ''
    const result = addParticipants(chunks, participants)
    if (result.list.length !== participants.length) onParticipantsChange(result.list)
    // ошибка — неподошедшее имя и всё после него остаются в поле, чтобы их можно было исправить
    onValueChange(result.error ? [...chunks.slice(result.failedAt), tail].join(',') : tail)
    onErrorChange(result.error)
  }

  const onKeyDown: TextFieldKeyDown = (event) => {
    // Enter во время набора через IME подтверждает вариант, а не добавляет тег
    if (event.nativeEvent.isComposing) return
    if (event.key === 'Enter') {
      // Enter добавляет тег и не отправляет форму
      event.preventDefault()
      if (!hasVisibleText(value)) return
      const error = validateParticipant(value, participants)
      if (error) {
        onErrorChange(error)
        return
      }
      onParticipantsChange([...participants, value.trim()])
      onValueChange('')
      onErrorChange(null)
    } else if (event.key === 'Backspace' && value === '' && participants.length > 0) {
      onParticipantsChange(participants.slice(0, -1))
      onErrorChange(null)
    }
  }

  // Удаление тега может снять только повтор или лимит: ошибка ввода пересчитывается по новому списку
  const onRemove = (keys: Set<Key>) => {
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
        validationBehavior="aria"
      >
        <Label>Участники</Label>
        <Input placeholder="Имя, затем Enter или запятая" />
        {/* место под ошибку занято всегда, чтобы кнопки не прыгали из-под курсора */}
        <div className="min-h-5">
          <FieldError>{error}</FieldError>
        </div>
      </TextField>

      {participants.length > 0 && (
        <TagGroup aria-label="Участники" onRemove={onRemove}>
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
