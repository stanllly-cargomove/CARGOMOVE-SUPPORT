import React from 'react';
import cargoMoveLogo from '../../../media/image-removebg-preview.png';

interface LogoProps {
  className?: string;
  size?: 'sm' | 'md' | 'lg';
  showTagline?: boolean;
  light?: boolean;
}

export function Logo({ className = '', size = 'md', showTagline = false, light = false }: LogoProps) {
  // Height & text size mappings
  const sizeClasses = {
    sm: {
      text: 'text-base',
      circle: 'w-4 h-4',
      tagline: 'text-[9px]',
    },
    md: {
      text: 'text-xl',
      circle: 'w-5 h-5',
      tagline: 'text-[10px]',
    },
    lg: {
      text: 'text-3xl',
      circle: 'w-7 h-7',
      tagline: 'text-xs',
    },
  };

  const currentSize = sizeClasses[size];

  return (
    <div className={`inline-flex items-center select-none ${className}`}>
      <img
        src={cargoMoveLogo}
        alt="CargoMove"
        className={`${size === 'sm' ? 'w-[132px]' : size === 'lg' ? 'w-[190px]' : 'w-[150px]'} h-auto object-contain`}
      />

      {showTagline && (
        <span className={`ml-2.5 text-slate-400 font-medium ${currentSize.tagline}`}>
          Port Clearance & EDI Engine
        </span>
      )}
    </div>
  );
}
