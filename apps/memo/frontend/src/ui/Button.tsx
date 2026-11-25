import type { ComponentProps } from 'react';
import { Icon } from './Icon';
import type { IconName } from './Icon';

export type ButtonVariant = 'primary' | 'secondary' | 'text';

export interface ButtonProps extends ComponentProps<'button'> {
  variant?: ButtonVariant;
  icon?: IconName;
  iconSize?: number;
}

const variants: Record<ButtonVariant, string> = {
  primary: 'primary',
  secondary: 'secondary',
  text: 'text-button',
};

export function Button({
  variant = 'secondary',
  icon,
  iconSize,
  className = '',
  type = 'button',
  children,
  ...props
}: ButtonProps) {
  return (
    <button {...props} type={type} className={`ui-button ${variants[variant]} ${className}`.trim()}>
      {icon && <Icon name={icon} size={iconSize} />}
      {children}
    </button>
  );
}
