/** Original Polling Pops mark: a candy on a stick with three rising poll bars. */
export function LollipopMark({ className }: { className?: string }) {
  return (
    <svg aria-hidden="true" className={className} fill="none" focusable="false" viewBox="0 0 64 80">
      <path d="m32 47 7 27" stroke="#39243C" strokeLinecap="round" strokeWidth="10" />
      <path d="m32 47 7 27" stroke="#FFF8E9" strokeLinecap="round" strokeWidth="5" />
      <circle cx="30" cy="29" fill="#F9688A" r="25" stroke="#39243C" strokeWidth="3" />
      <path d="M9 32C14 12 42 7 51 23" stroke="#FFF8E9" strokeLinecap="round" strokeWidth="6" />
      <path d="M10 40c12 12 32 12 42-4" stroke="#FFC857" strokeLinecap="round" strokeWidth="4" />
      <path d="M20 35v5" stroke="#FFF8E9" strokeLinecap="round" strokeWidth="5" />
      <path d="M30 28v12" stroke="#FFF8E9" strokeLinecap="round" strokeWidth="5" />
      <path d="M40 22v18" stroke="#FFF8E9" strokeLinecap="round" strokeWidth="5" />
      <path d="m57 7 2-4m-2 12 4 1" stroke="#20806A" strokeLinecap="round" strokeWidth="3" />
    </svg>
  );
}
