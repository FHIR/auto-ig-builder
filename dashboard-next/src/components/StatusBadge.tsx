export function StatusBadge({ success }: { success: boolean }) {
  return (
    <span className={`badge ${success ? 'badge-pass' : 'badge-fail'}`}>
      {success ? 'pass' : 'fail'}
    </span>
  )
}
