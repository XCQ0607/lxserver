/*
   UI Utilities for LX Sync Server Management Console
   Standardizes notifications (Toasts) and Dialogs
   Requires: Tailwind CSS, FontAwesome
*/

(function () {
    // Presentation lives in style.css; helpers below only manage dialog state.


    /**
     * Fresh Toast Notification (Solid Card Style)
     */
    function showToast(type, message, duration = 3000) {
        const config = {
            success: { tone: 'tone-fill-success ', icon: 'fa-check-circle' },
            info: { tone: 'tone-fill-info ', icon: 'fa-info-circle' },
            error: { tone: 'tone-fill-danger ', icon: 'fa-exclamation-circle' }
        };
        const conf = config[type] || config.info;

        const toast = document.createElement('div');
        toast.className = `toast-item fixed bottom-8 right-8 z-[5000] lx-toast-in`;

        toast.innerHTML = `
            <div class="lx-toast-card px-5 py-3.5 rounded-2xl flex items-center gap-4 min-w-[320px] max-w-[450px]">
                <div class="w-10 h-10 rounded-xl ${conf.tone} flex items-center justify-center shadow-lg shrink-0">
                    <i class="fas ${conf.icon} text-lg"></i>
                </div>
                <div class="flex-1 overflow-hidden">
                    <div class="text-sm font-bold tone-text pr-2">${message}</div>
                </div>
                <button class="lx-close-btn w-8 h-8 tone-muted text-hover rounded-full ml-1 shrink-0">
                    <i class="fas fa-times text-sm"></i>
                </button>
            </div>
        `;

        const gap = 12;
        let bottomBase = 32;

        document.body.appendChild(toast);

        // Position stack (Bottom-up)
        const toasts = document.querySelectorAll('.toast-item');
        toasts.forEach((el) => {
            if (el === toast) return;
            const h = el.offsetHeight;
            const oldB = parseFloat(el.style.bottom || bottomBase);
            const newB = oldB + h + gap;
            el.style.bottom = `${newB}px`;
            el.dataset.offset = newB;
        });

        toast.style.bottom = `${bottomBase}px`;
        toast.dataset.offset = bottomBase;

        const removeToast = () => {
            toast.classList.replace('lx-toast-in', 'opacity-0');
            toast.style.transform = 'scale(0.9) translateX(20px)';
            setTimeout(() => {
                const currentOffset = parseFloat(toast.dataset.offset);
                const h = toast.offsetHeight + gap;
                toast.remove();
                document.querySelectorAll('.toast-item').forEach(el => {
                    const elB = parseFloat(el.style.bottom || 0);
                    if (elB > currentOffset) {
                        const newB = elB - h;
                        el.style.bottom = `${newB}px`;
                        el.dataset.offset = newB;
                    }
                });
            }, 400);
        };

        const timer = setTimeout(removeToast, duration);
        toast.querySelector('button').onclick = () => {
            clearTimeout(timer);
            removeToast();
        };
    }

    /**
     * Fresh Confirmation Modal (Clean & Modern)
     */
    function showSelect(title, message, options = {}) {
        const {
            confirmText = '确定',
            cancelText = '取消',
            danger = false
        } = options;

        const accentTone = danger ? 'tone-fill-danger  ' : 'tone-fill-success  ';
        const icon = danger ? 'fa-exclamation-triangle' : 'fa-question-circle';
        const iconClass = danger ? 'tone-danger' : 'tone-success';

        return new Promise((resolve) => {
            const modal = document.createElement('div');
            modal.className = "fixed inset-0 z-[3000] flex items-center justify-center p-6 animate-fade-in";
            modal.innerHTML = `
                <div class="absolute inset-0 modal-backdrop backdrop-blur-[4px]"></div>
                <div class="lx-glass rounded-[28px] w-full max-w-sm overflow-hidden lx-modal-in relative shadow-2xl">
                    <button id="modal-close-x" class="lx-close-btn absolute top-5 right-5 w-8 h-8 tone-muted text-hover rounded-full z-10">
                        <i class="fas fa-times text-sm"></i>
                    </button>
                    <div class="p-8">
                        <div class="flex flex-col items-center text-center gap-5">
                            <div class="w-16 h-16 rounded-3xl tone-inset flex items-center justify-center ${iconClass} border border-default mb-2">
                                <i class="fas ${icon} text-3xl"></i>
                            </div>
                            <div class="space-y-2">
                                <h3 class="text-xl font-bold tone-text tracking-tight">${title}</h3>
                                <p class="text-sm tone-secondary leading-relaxed px-4">${message.replace(/\n/g, '<br>')}</p>
                            </div>
                        </div>
                    </div>
                    <div class="p-5 flex gap-3">
                        <button id="confirm-cancel" class="lx-btn flex-1 py-3.5 text-sm font-bold tone-muted text-hover tone-inset surface-hover rounded-2xl">
                            ${cancelText}
                        </button>
                        <button id="confirm-ok" class="lx-btn flex-1 py-3.5 text-sm font-bold ${accentTone} rounded-2xl shadow-lg uppercase tracking-wider">
                            ${confirmText}
                        </button>
                    </div>
                </div>
            `;

            document.body.appendChild(modal);

            const close = (result) => {
                const content = modal.querySelector('.lx-modal-in');
                if (content) {
                    content.style.transform = 'scale(0.9) translateY(10px)';
                    content.style.opacity = '0';
                    modal.classList.add('opacity-0');
                }
                setTimeout(() => {
                    modal.remove();
                    resolve(result);
                }, 300);
            };

            modal.querySelector('#confirm-ok').onclick = () => close(true);
            modal.querySelector('#confirm-cancel').onclick = () => close(false);
            if (modal.querySelector('#modal-close-x')) {
                modal.querySelector('#modal-close-x').onclick = () => close(false);
            }
        });
    }

    /**
     * Fresh Input Modal
     */
    function showInput(title, message, options = {}) {
        const {
            placeholder = '请输入内容...',
            defaultValue = '',
            confirmText = '确定',
            cancelText = '取消',
            inputType = 'text'
        } = options;

        return new Promise((resolve) => {
            const modal = document.createElement('div');
            modal.className = "fixed inset-0 z-[3000] flex items-center justify-center p-6 animate-fade-in";
            modal.innerHTML = `
                <div class="absolute inset-0 modal-backdrop backdrop-blur-[4px]"></div>
                <div class="lx-glass rounded-[28px] w-full max-w-sm overflow-hidden lx-modal-in relative shadow-2xl">
                    <button id="modal-close-x" class="lx-close-btn absolute top-5 right-5 w-8 h-8 tone-muted text-hover rounded-full z-10">
                        <i class="fas fa-times text-sm"></i>
                    </button>
                    <div class="p-8">
                        <div class="flex flex-col items-center text-center gap-5">
                            <div class="w-16 h-16 rounded-3xl tone-inset flex items-center justify-center tone-success border border-default">
                                <i class="fas fa-edit text-3xl"></i>
                            </div>
                            <div class="space-y-2 w-full text-center">
                                <h3 class="text-xl font-bold tone-text tracking-tight">${title}</h3>
                                <p class="text-sm tone-secondary leading-relaxed mb-6">${message}</p>
                                <input type="${inputType}" id="modal-input"
                                    class="lx-input w-full px-5 py-4 rounded-2xl outline-none text-base"
                                    placeholder="${placeholder}" value="${defaultValue}">
                            </div>
                        </div>
                    </div>
                    <div class="p-5 flex gap-3">
                        <button id="confirm-cancel" class="lx-btn flex-1 py-3.5 text-sm font-bold tone-muted text-hover tone-inset surface-hover rounded-2xl">
                            ${cancelText}
                        </button>
                        <button id="confirm-ok" class="lx-btn flex-1 py-3.5 text-sm font-bold tone-fill-success shadow-lg rounded-2xl uppercase tracking-wider">
                            ${confirmText}
                        </button>
                    </div>
                </div>
            `;

            document.body.appendChild(modal);

            const input = modal.querySelector('#modal-input');
            input.focus();
            if (defaultValue) input.select();

            const close = (result) => {
                const content = modal.querySelector('.lx-modal-in');
                if (content) {
                    content.style.transform = 'scale(0.9) translateY(10px)';
                    content.style.opacity = '0';
                    modal.classList.add('opacity-0');
                }
                setTimeout(() => {
                    modal.remove();
                    resolve(result);
                }, 300);
            };

            modal.querySelector('#confirm-ok').onclick = () => close(input.value);
            modal.querySelector('#confirm-cancel').onclick = () => close(null);

            input.onkeydown = (e) => {
                if (e.key === 'Enter') close(input.value);
                if (e.key === 'Escape') close(null);
            };
        });
    }

    /**
     * Marquee Helpers
     */
    function createMarqueeHtml(text, className = '') {
        return `<div class="truncate dynamic-marquee min-w-0 ${className}" data-text="${text.replace(/"/g, '&quot;')}">${text}</div>`;
    }

    function applyMarqueeChecks() {
        setTimeout(() => {
            const elements = document.querySelectorAll('.dynamic-marquee.truncate');
            elements.forEach(el => {
                if (el.scrollWidth > el.clientWidth) {
                    const text = el.getAttribute('data-text') || el.innerText;
                    const gap = '<span class="mx-8"></span>';
                    el.classList.remove('truncate');
                    el.classList.add('overflow-hidden');
                    const maskStyle = ''; // Solid edges use the container's overflow clipping.
                    el.innerHTML = `
                    <div class="w-full relative" style="${maskStyle}">
                        <div class="inline-block whitespace-nowrap animate-marquee hover:pause-animation">
                            <span>${text}</span>${gap}<span>${text}</span>${gap}
                        </div>
                    </div>`;
                }
            });
        }, 50);
    }

    // Expose to global
    window.createMarqueeHtml = createMarqueeHtml;
    window.applyMarqueeChecks = applyMarqueeChecks;
    window.showToast = showToast;
    window.showSuccess = (msg) => showToast('success', msg, 2000);
    window.showInfo = (msg) => showToast('info', msg, 2000);
    window.showError = (msg) => showToast('error', msg, 3000);
    window.showSelect = showSelect;
    window.showInput = showInput;

    // Listen for resize
    window.addEventListener('resize', () => {
        clearTimeout(window._marqueeResizeTimer);
        window._marqueeResizeTimer = setTimeout(applyMarqueeChecks, 300);
    });

})();
