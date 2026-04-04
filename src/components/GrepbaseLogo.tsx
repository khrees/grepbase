interface GrepbaseLogoProps {
    size?: number;
    color?: string;
}

export default function GrepbaseLogo({ size = 28, color = '#0070f3' }: GrepbaseLogoProps) {
    return (
        <svg
            width={size}
            height={size}
            viewBox="0 0 100 100"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            aria-label="Grepbase"
        >
            <circle cx="50" cy="50" r="35" stroke={color} strokeWidth="12" strokeLinecap="round" />
            <path d="M55 50 L85 50" stroke={color} strokeWidth="12" strokeLinecap="round" />
            <path d="M75 75 L95 95" stroke={color} strokeWidth="12" strokeLinecap="round" />
        </svg>
    );
}
