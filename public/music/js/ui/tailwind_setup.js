/**
 * Tailwind Configuration Injection
 * This file injects the tailwind configuration to map 'emerald' to our CSS variables.
 * Must be loaded AFTER tailwindcss.js (CDN) or configured appropriately.
 */

tailwind.config = {
    darkMode: 'class',
    theme: {
        extend: {
            screens: {
                // Keep every breakpoint in px: Tailwind v4 sorts mixed units separately,
                // which otherwise puts the default 40rem sm rules after desktop rules.
                'sm': '640px',
                // Shift all breakpoints up to accommodate iPad Pro Portrait (1024px) as mobile
                'md': '1025px', // Desktop boundary
                'lg': '1280px',
                'xl': '1440px',
                '2xl': '1536px',
            },
            colors: {
                // Override 'emerald' to use our CSS variables
                // This allows us to change the theme without changing class names in HTML
                emerald: {
                    50: 'var(--c-50)',
                    100: 'var(--c-100)',
                    200: 'var(--c-200)',
                    300: 'var(--c-300)',
                    400: 'var(--c-400)',
                    500: 'var(--c-500)',
                    600: 'var(--c-600)',
                    700: 'var(--c-700)',
                    800: 'var(--c-800)',
                    900: 'var(--c-900)',
                    950: 'var(--c-950)',
                }
            }
        }
    }
}
