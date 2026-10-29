'use client'

import { Eye, EyeSlash } from '@gravity-ui/icons'
import { Button, FieldError, InputGroup, Label, TextField } from '@heroui/react'
import { type ComponentProps, useState } from 'react'

interface PasswordFieldProps extends Pick<
  ComponentProps<typeof TextField>,
  'name' | 'autoComplete' | 'validate' | 'value' | 'onChange'
> {
  label: string
  placeholder: string
  errorText?: string
}

export function PasswordField({
  label,
  placeholder,
  errorText,
  ...fieldProps
}: PasswordFieldProps) {
  const [visible, setVisible] = useState(false)

  return (
    <TextField
      isRequired
      fullWidth
      aria-label={label}
      variant="secondary"
      type="password"
      {...fieldProps}
    >
      <Label>{label}</Label>
      <InputGroup fullWidth variant="secondary">
        <InputGroup.Input placeholder={placeholder} type={visible ? 'text' : 'password'} />
        <InputGroup.Suffix className="pe-0">
          <Button
            isIconOnly
            excludeFromTabOrder
            aria-label={visible ? 'Скрыть пароль' : 'Показать пароль'}
            size="sm"
            variant="ghost"
            onPress={() => setVisible(!visible)}
          >
            {visible ? <Eye className="size-4" /> : <EyeSlash className="size-4" />}
          </Button>
        </InputGroup.Suffix>
      </InputGroup>
      <FieldError>{errorText}</FieldError>
    </TextField>
  )
}
