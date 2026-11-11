// The LoTUS-BF lotus: five petals for the terms, a teal crosshair for the location, water underneath.
export default function Logo({ className = 'size-10' }) {
  return (
    <svg viewBox="0 0 64 64" className={className} role="img" aria-label="LoTUS-BF logo">
      <defs>
        <linearGradient id="lotus-outer" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fbcfe1" />
          <stop offset="1" stopColor="#f273a1" />
        </linearGradient>
        <linearGradient id="lotus-inner" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#f8a8c6" />
          <stop offset="1" stopColor="#e8477f" />
        </linearGradient>
        <linearGradient id="lotus-center" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#f273a1" />
          <stop offset="1" stopColor="#b21d4f" />
        </linearGradient>
      </defs>
      <path d="M32 52C18 52 7 42 4 29c12 0 23 9 28 23Z" fill="url(#lotus-outer)" />
      <path d="M32 52c14 0 25-10 28-23-12 0-23 9-28 23Z" fill="url(#lotus-outer)" />
      <path d="M32 52c-10-6-17-20-15-35 10 5 16 19 15 35Z" fill="url(#lotus-inner)" />
      <path d="M32 52c10-6 17-20 15-35-10 5-16 19-15 35Z" fill="url(#lotus-inner)" />
      <path d="M32 52c-8-10-8-30 0-44 8 14 8 34 0 44Z" fill="url(#lotus-center)" />
      <circle cx="32" cy="33" r="4.2" fill="#fff" />
      <circle cx="32" cy="33" r="2" fill="#0d9488" />
      <path d="M32 26v3M32 37v3M25 33h3M36 33h3" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" />
      <path d="M10 57q22 6 44 0" stroke="#14b8a6" strokeWidth="3" fill="none" strokeLinecap="round" />
    </svg>
  )
}
