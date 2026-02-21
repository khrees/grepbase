'use client';

import { useState } from 'react';
import { Settings } from 'lucide-react';
import SettingsModal from '@/components/SettingsModal';

export default function ClientSettingsHeader() {
    const [showSettings, setShowSettings] = useState(false);

    return (
        <>
            <button
                className="btn btn-ghost"
                onClick={() => setShowSettings(true)}
            >
                <Settings size={20} />
                Settings
            </button>

            <SettingsModal
                isOpen={showSettings}
                onClose={() => setShowSettings(false)}
            />
        </>
    );
}
