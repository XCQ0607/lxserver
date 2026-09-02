/**
 * Common UI & Initialization Helpers
 */

(function () {
    // --- Setting Tooltips Mobile Support ---

    /**
     * After a tooltip becomes visible, clamp it so it never overflows the viewport.
     * Applies a corrective margin-left to the .setting-tooltip-content element.
     */
    function clampTooltipPosition(trigger) {
        const tooltip = trigger.querySelector('.setting-tooltip-content');
        if (!tooltip) return;

        // Reset any previous correction first
        tooltip.style.marginLeft = '';

        // Use rAF to ensure the browser has rendered the tooltip at its natural position
        requestAnimationFrame(() => {
            const rect = tooltip.getBoundingClientRect();
            const padding = 8; // min distance from viewport edge (px)
            let correction = 0;

            if (rect.left < padding) {
                // Overflows left edge → push right
                correction = padding - rect.left;
            } else if (rect.right > window.innerWidth - padding) {
                // Overflows right edge → push left
                correction = (window.innerWidth - padding) - rect.right;
            }

            if (correction !== 0) {
                tooltip.style.marginLeft = correction + 'px';
            }
        });
    }

    document.addEventListener('click', function (e) {
        const trigger = e.target.closest('.setting-tooltip-trigger');

        // Close all other tooltips
        document.querySelectorAll('.setting-tooltip-trigger.is-active').forEach(activeTrigger => {
            if (activeTrigger !== trigger) {
                activeTrigger.classList.remove('is-active');
                const t = activeTrigger.querySelector('.setting-tooltip-content');
                if (t) t.style.marginLeft = '';
            }
        });

        if (trigger) {
            // If it's a mobile device (or doesn't support hover)
            if (window.matchMedia('(hover: none)').matches) {
                trigger.classList.toggle('is-active');
                if (trigger.classList.contains('is-active')) {
                    clampTooltipPosition(trigger);
                } else {
                    const t = trigger.querySelector('.setting-tooltip-content');
                    if (t) t.style.marginLeft = '';
                }
                e.stopPropagation();
            }
        }
    });

    // Close tooltip when clicking outside
    document.addEventListener('touchstart', function (e) {
        if (!e.target.closest('.setting-tooltip-trigger')) {
            document.querySelectorAll('.setting-tooltip-trigger.is-active').forEach(trigger => {
                trigger.classList.remove('is-active');
                const t = trigger.querySelector('.setting-tooltip-content');
                if (t) t.style.marginLeft = '';
            });
        }
    }, { passive: true });
})();


/**
 * 跳转至管理后台
 */
function goToAdmin() {
    var adminPath = (window.CONFIG && window.CONFIG['admin.path']) || '/music';
    location.href = adminPath;
}

/**
 * --- Project Agreement Modal Logic ---
 */

/**
 * 检查是否已接受协议，若未接受则展示弹窗
 */
function checkProjectAgreement() {
    console.log('[Agreement] Checking project agreement status...');
    const isAccepted = localStorage.getItem('lx_agreement_accepted');
    const modal = document.getElementById('project-agreement-modal');

    if (isAccepted === 'true') {
        console.log('[Agreement] Status: Already accepted.');
        return;
    }

    if (modal) {
        console.log('[Agreement] Status: Not accepted. Showing modal.');
        // 将 modal 移到 body 直接子元素，防止被祖先 transform/hidden 容器破坏布局
        document.body.appendChild(modal);
        modal.classList.remove('hidden');
        document.body.style.overflow = 'hidden';
    } else {
        console.warn('[Agreement] Modal element not found!');
    }
}

/**
 * 接受协议并关闭弹窗
 */
function acceptProjectAgreement() {
    localStorage.setItem('lx_agreement_accepted', 'true');
    const modal = document.getElementById('project-agreement-modal');
    if (modal) {
        modal.classList.add('opacity-0');
        setTimeout(() => {
            modal.classList.add('hidden');
            document.body.style.overflow = '';
            // 接受后自动跳转到关于界面展示详细协议
            readAgreementInAbout();
        }, 300);
    }
}

/**
 * 在“关于”页面查看详细协议并自动滚动
 */
function readAgreementInAbout() {
    if (typeof switchTab === 'function') {
        switchTab('about');
        setTimeout(() => {
            const aboutContainer = document.getElementById('view-about');
            if (aboutContainer) {
                const agreementHeader = Array.from(aboutContainer.querySelectorAll('h2')).find(h => h.innerText.includes('项目协议'));
                if (agreementHeader) {
                    agreementHeader.scrollIntoView({ behavior: 'smooth' });
                } else {
                    aboutContainer.scrollTo({ top: aboutContainer.scrollHeight, behavior: 'smooth' });
                }
            }
        }, 500);
    }

    // 手机端自动收起侧边栏
    if (window.innerWidth <= 1024 && typeof toggleSidebar === 'function') {
        const sidebar = document.getElementById('main-sidebar');
        if (sidebar && !sidebar.classList.contains('-translate-x-full')) {
            toggleSidebar();
        }
    }
}

// 自动初始化
document.addEventListener('DOMContentLoaded', () => {
    checkProjectAgreement();
});
