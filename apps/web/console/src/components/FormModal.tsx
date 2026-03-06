import type { ReactNode } from "react";

type Props = {
  title: string;
  children: ReactNode;
  onClose: () => void;
};

export function FormModal({ title, children, onClose }: Props) {
  return (
    <div className="modal-backdrop" onClick={onClose} role="presentation">
      <div
        aria-label={title}
        aria-modal="true"
        className="modal-panel"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
      >
        <div className="modal-head">
          <h3>{title}</h3>
          <button className="ghost" onClick={onClose} type="button">
            关闭
          </button>
        </div>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}
