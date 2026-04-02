'use client';

import React from 'react';

interface LogoProps {
  size?: number;
  className?: string;
}

/**
 * Grepbase Magnifier G Logo Component
 * A minimalist, geometric 'G' that doubles as a magnifying glass.
 */
export const Logo: React.FC<LogoProps> = ({ size = 40, className }) => {
  return (
    <svg 
      width={size} 
      height={size} 
      viewBox="0 0 100 100" 
      fill="none" 
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-label="Grepbase Logo"
    >
      <circle 
        cx="50" 
        cy="50" 
        r="35" 
        stroke="currentColor" 
        strokeWidth="12" 
        strokeLinecap="round"
      />
      <path 
        d="M55 50 L85 50" 
        stroke="currentColor" 
        strokeWidth="12" 
        strokeLinecap="round"
      />
      <path 
        d="M75 75 L95 95" 
        stroke="currentColor" 
        strokeWidth="12" 
        strokeLinecap="round"
      />
    </svg>
  );
};
