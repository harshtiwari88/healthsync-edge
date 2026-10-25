import React from 'react';

export const LungsIcon: React.FC<{className?: string}> = ({className = 'w-5 h-5'}) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
    aria-hidden="true"
  >
    <path d="M12 3v8" />
    <path d="M12 11l-3 2.5" />
    <path d="M12 11l3 2.5" />
    <path d="M9.2 7.5C6.2 7.5 3.5 10.5 3 15.2c-.3 2.8 1.2 4.8 3.6 4.8 2.1 0 3.4-1.3 3.4-3.5V10c0-1.4-.3-2.5-.8-2.5z" />
    <path d="M14.8 7.5c3 0 5.7 3 6.2 7.7.3 2.8-1.2 4.8-3.6 4.8-2.1 0-3.4-1.3-3.4-3.5V10c0-1.4.3-2.5.8-2.5z" />
  </svg>
);
