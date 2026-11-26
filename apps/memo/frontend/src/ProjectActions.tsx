import { useRef, useState } from 'react';
import type { Project } from './types';
import { Button, Popover } from './ui';

export function ProjectActions({
  project,
  busy,
  exportProject,
  deleteProject,
}: {
  project: Project;
  busy: boolean;
  exportProject: () => void;
  deleteProject: () => void;
}) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const id = `project-actions-${project.id}`;
  const choose = (action: () => void) => {
    trigger.current?.focus();
    setOpen(false);
    action();
  };
  return (
    <div className="project-row-actions">
      <Button
        ref={trigger}
        variant="text"
        disabled={busy}
        aria-label={`Действия с проектом ${project.name}`}
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onClick={() => setOpen((value) => !value)}
      >
        Действия
      </Button>
      {open && (
        <Popover
          id={id}
          role="region"
          aria-label={`Действия с проектом ${project.name}`}
          trigger={trigger}
          onDismiss={() => setOpen(false)}
          className="project-actions-panel"
        >
          <Button variant="text" disabled={busy} onClick={() => choose(exportProject)}>
            Экспорт
          </Button>
          <Button
            variant="text"
            className="danger"
            disabled={busy}
            onClick={() => choose(deleteProject)}
          >
            В корзину
          </Button>
        </Popover>
      )}
    </div>
  );
}
