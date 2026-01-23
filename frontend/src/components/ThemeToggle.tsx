import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';

/**
 * Theme toggle with sun/moon icons and smooth animation.
 * Uses data-theme attribute on document.documentElement for CSS theming.
 */
export function ThemeToggle() {
    const [isDark, setIsDark] = useState(() => {
        // Check localStorage first, then system preference
        const saved = localStorage.getItem('theme');
        if (saved) return saved === 'dark';
        return window.matchMedia('(prefers-color-scheme: dark)').matches;
    });

    useEffect(() => {
        // Apply theme to document
        document.documentElement.setAttribute('data-theme', isDark ? 'dark' : 'light');
        localStorage.setItem('theme', isDark ? 'dark' : 'light');
    }, [isDark]);

    const toggleTheme = () => setIsDark(!isDark);

    return (
        <motion.button
            onClick={toggleTheme}
            className="theme-toggle"
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            transition={{ type: 'spring', stiffness: 400, damping: 17 }}
            aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
            title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
        >
            <motion.span
                key={isDark ? 'moon' : 'sun'}
                initial={{ rotate: -90, opacity: 0 }}
                animate={{ rotate: 0, opacity: 1 }}
                exit={{ rotate: 90, opacity: 0 }}
                transition={{ duration: 0.2 }}
                className="theme-icon"
            >
                {isDark ? '🌙' : '☀️'}
            </motion.span>
        </motion.button>
    );
}
