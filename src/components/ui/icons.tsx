import React from 'react';

export const Tooth: React.FC<{ className?: string, size?: number }> = ({ className, size = 24 }) => (
    <svg
        xmlns="http://www.w3.org/2000/svg"
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className={className}
    >
        <path d="M7 3C4.23858 3 2 5.23858 2 8C2 13 4 21 8 21C9 21 10 20 10 18C10 16 11 15 12 15C13 15 14 16 14 18C14 20 15 21 16 21C20 21 22 13 22 8C22 5.23858 19.7614 3 17 3C14.2386 3 13.5 4.5 12 4.5C10.5 4.5 9.76142 3 7 3Z" />
    </svg>
);
