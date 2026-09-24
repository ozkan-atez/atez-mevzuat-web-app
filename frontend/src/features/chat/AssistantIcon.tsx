export function AssistantIcon({ className = 'h-8 w-8' }: { className?: string }) {
  return (
    <svg aria-hidden="true" className={className} viewBox="0 0 32 32">
      <circle cx="16" cy="5" r="2.25" fill="currentColor" />
      <circle cx="23.8" cy="8.2" r="2.25" fill="currentColor" />
      <circle cx="27" cy="16" r="2.25" fill="currentColor" />
      <circle cx="23.8" cy="23.8" r="2.25" fill="currentColor" />
      <circle cx="16" cy="27" r="2.25" fill="currentColor" />
      <circle cx="8.2" cy="23.8" r="2.25" fill="currentColor" />
      <circle cx="5" cy="16" r="2.25" fill="currentColor" />
      <circle cx="8.2" cy="8.2" r="2.25" fill="currentColor" />
    </svg>
  )
}
