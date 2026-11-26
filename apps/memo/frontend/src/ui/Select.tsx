import type { ComponentProps } from 'react';

export function Select({ label, ...props }: ComponentProps<'select'> & { label: string }) {
  return (
    <label>
      {label}
      <select {...props} />
    </label>
  );
}
