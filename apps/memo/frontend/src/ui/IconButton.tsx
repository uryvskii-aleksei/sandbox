import type { ComponentProps } from 'react';
import { Icon } from './Icon';
import type { IconName } from './Icon';

export interface IconButtonProps extends Omit<
  ComponentProps<'button'>,
  'children' | 'aria-label' | 'title'
> {
  label: string;
  icon: IconName;
  iconSize?: number;
  tooltip?: string;
}

export function IconButton({
  label,
  icon,
  iconSize,
  tooltip,
  className = '',
  type = 'button',
  ...props
}: IconButtonProps) {
  return (
    <button
      {...props}
      type={type}
      className={`icon-button ${className}`.trim()}
      aria-label={label}
      title={tooltip ? undefined : label}
      data-tooltip={tooltip}
    >
      <Icon name={icon} size={iconSize} />
    </button>
  );
}
