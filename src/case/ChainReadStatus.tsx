type ReadStatus =
  | { status: 'loading' | 'ready'; value?: unknown }
  | { status: 'error'; error: string; value?: unknown };

export function ChainReadStatus({
  label,
  read,
  retry,
}: {
  label: string;
  read?: ReadStatus;
  retry: () => void;
}) {
  if (read?.status === 'ready') return null;
  if (read?.status !== 'error') return <p role="status">Reading {label}…</p>;
  return (
    <div className="cases-read-error">
      <p role="alert">
        Could not read {label}. {read.error}
        {read.value !== undefined && ' Showing the last confirmed value.'}
      </p>
      <button type="button" onClick={retry}>
        Retry {label}
      </button>
    </div>
  );
}
