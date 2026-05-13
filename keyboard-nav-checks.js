// ===== CHECK 9: Keyboard-interactive elements without keyboard support (STRICT HTML CHECK) =====
    const keyboardIssues = [];
    
    // Check 9a: Divs/spans with onclick but no keyboard handler
    Array.from(document.querySelectorAll('div[onclick], span[onclick]')).forEach(el => {
        const hasKeyHandler = el.getAttribute('onkeydown') || el.getAttribute('onkeypress') || el.getAttribute('onkeyup');
        const hasRole = el.getAttribute('role');
        const hasTabindex = el.getAttribute('tabindex');
        
        // This is WRONG: onclick without keyboard equivalent
        if (!hasKeyHandler) {
            keyboardIssues.push({
                element: el.tagName,
                class: el.className,
                issue: `${el.tagName}[onclick] without keyboard handler (onkeydown/onkeypress)`,
                hasRole: hasRole ? `role="${hasRole}"` : 'no role',
                hasTabindex: hasTabindex ? `tabindex="${hasTabindex}"` : 'not tabbable'
            });
        }
    });
    
    // Check 9b: Interactive elements not in tab order (tabindex < 0)
    Array.from(document.querySelectorAll('[onclick], [role="button"], [role="link"]')).forEach(el => {
        if (el.tagName !== 'BUTTON' && el.tagName !== 'A') {
            const tabindex = el.getAttribute('tabindex');
            if (tabindex === '-1') {
                keyboardIssues.push({
                    element: el.tagName,
                    issue: `Interactive element removed from tab order (tabindex="-1")`,
                    hasRole: el.getAttribute('role') || 'none'
                });
            }
        }
    });
    
    // Check 9c: Positive tabindex values (disrupts natural order)
    Array.from(document.querySelectorAll('[tabindex]')).forEach(el => {
        const tabindex = parseInt(el.getAttribute('tabindex'));
        if (tabindex > 0) {
            keyboardIssues.push({
                element: el.tagName,
                issue: `Positive tabindex="${tabindex}" disrupts natural tab order (use 0 or omit)`,
                id: el.id || 'no-id'
            });
        }
    });
    
    if (keyboardIssues.length > 0) {
        addDebugLog(`[VIOLATION] ${keyboardIssues.length} keyboard navigation HTML issues`);
        manualViolations.push({
            id: 'keyboard-navigation',
            description: 'Interactive elements must be keyboard accessible (onclick needs onkeydown, proper tabindex)',
            impact: 'serious',
            nodes: keyboardIssues.map((issue, i) => ({
                message: `${i + 1}. <${issue.element}> ${issue.issue}${issue.hasRole ? ' (' + issue.hasRole + ')' : ''}`
            }))
        });
    }
