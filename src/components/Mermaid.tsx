'use client';

import { useEffect, useRef, useState } from 'react';
import mermaid from 'mermaid';

// Initialize mermaid once client-side
let mermaidInitialized = false;

function ensureMermaidInitialized() {
    if (mermaidInitialized || typeof window === 'undefined') return;
    mermaidInitialized = true;
    mermaid.initialize({
        startOnLoad: false,
        theme: 'dark',
        securityLevel: 'loose',
        themeVariables: {
            background: '#0d1117',
            primaryColor: '#0070f3',
            primaryTextColor: '#c9d1d9',
            lineColor: '#30363d',
            actorBkg: '#161b22',
            actorBorder: '#30363d',
            signalColor: '#3291ff',
            signalLineColor: '#30363d',
        }
    });
}

let uniqueId = 0;

interface MermaidProps {
    chart: string;
}

export default function Mermaid({ chart }: MermaidProps) {
    const elementId = useRef(`mermaid-${uniqueId++}`);
    const [svg, setSvg] = useState<string>('');
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        ensureMermaidInitialized();
        let active = true;

        async function renderChart() {
            try {
                const cleanChart = chart.trim();
                if (!cleanChart) return;
                
                const { svg: renderedSvg } = await mermaid.render(elementId.current, cleanChart);
                if (active) {
                    setSvg(renderedSvg);
                    setError(null);
                }
            } catch (err) {
                if (active) {
                    // Try to extract a clean message
                    const msg = err instanceof Error ? err.message : String(err);
                    setError(msg);
                }
                
                // Reset mermaid rendering state on error so subsequent renders don't block
                try {
                    const badElement = document.getElementById(elementId.current);
                    if (badElement) badElement.remove();
                } catch {
                    // Ignore cleanup errors
                }
            }
        }

        renderChart();

        return () => {
            active = false;
        };
    }, [chart]);

    if (error) {
        return (
            <div className="mermaid-error" style={{
                padding: '12px',
                border: '1px solid rgba(238, 0, 0, 0.2)',
                background: 'rgba(238, 0, 0, 0.05)',
                borderRadius: '6px',
                margin: '12px 0',
            }}>
                <span style={{ color: '#ff5555', fontWeight: 600, fontSize: '0.8rem', display: 'block', marginBottom: '6px' }}>
                    Failed to render diagram
                </span>
                <pre style={{
                    color: '#8b949e',
                    fontSize: '0.75rem',
                    fontFamily: 'var(--font-mono)',
                    overflowX: 'auto',
                    whiteSpace: 'pre-wrap',
                    margin: 0,
                }}>{chart}</pre>
            </div>
        );
    }

    if (!svg) {
        return (
            <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                padding: '16px',
                color: 'var(--text-secondary)',
                fontSize: '0.8rem',
                fontFamily: 'var(--font-mono)',
            }}>
                <span style={{
                    width: '12px',
                    height: '12px',
                    border: '2px solid var(--accent-primary)',
                    borderTopColor: 'transparent',
                    borderRadius: '50%',
                    animation: 'spin 1s linear infinite',
                    display: 'inline-block',
                }} />
                Rendering flow diagram...
            </div>
        );
    }

    return (
        <div 
            className="mermaid-wrapper" 
            style={{ 
                margin: '20px 0', 
                background: 'rgba(0, 0, 0, 0.2)', 
                border: '1px solid var(--border-default)', 
                borderRadius: '8px', 
                padding: '16px',
                display: 'flex',
                justifyContent: 'center',
                overflowX: 'auto',
            }}
            dangerouslySetInnerHTML={{ __html: svg }} 
        />
    );
}
