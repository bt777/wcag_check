const validateBtn = document.getElementById('validateBtn');
const reportBtn = document.getElementById('reportBtn');
const statusDiv = document.getElementById('status');
const resultsDiv = document.getElementById('results');
const welcomeDiv = document.getElementById('welcome');
const issuesListDiv = document.getElementById('issuesList');
const scoreDisplay = document.getElementById('scoreDisplay');

let lastResults = null;
let isValidating = false;

validateBtn.addEventListener('click', validatePage);
reportBtn.addEventListener('click', showDetailedReport);

async function validatePage() {
	
	console.log('===== WCAG VALIDATION START =====');
	
    if (isValidating) return;
    
    isValidating = true;
    validateBtn.disabled = true;
    reportBtn.disabled = true;
    statusDiv.classList.remove('hidden');
    resultsDiv.classList.add('hidden');
    welcomeDiv.classList.add('hidden');

    updateStatus('Getting active tab...', 5);

    try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        console.log('[Popup] Active tab found:', { tabId: tab.id, url: tab.url });

        if (!tab) {
            throw new Error('No active tab found');
        }

        updateStatus('Waiting for page to be ready...', 10);
        console.log('[Popup] Waiting for page readiness...');
        
        // Wait for page to be fully loaded
        await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            function: waitForPageReady
        });
        console.log('[Popup] ✓ Page is ready');

        updateStatus('Injecting axe-core library...', 15);
        console.log('[Popup] Injecting axe.min.js...');

        // Inject axe.min.js
        await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            files: ['axe.min.js']
        });
        console.log('[Popup] ✓ axe.min.js injected successfully');

        updateStatus('Verifying axe-core...', 25);
        
        // Verify axe loaded
        const verifyResult = await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            function: () => ({
                axeExists: typeof window.axe !== 'undefined',
                axeVersion: window.axe?.version || 'unknown',
                documentReady: document.readyState,
                bodyReady: !!document.body
            })
        });
        
        console.log('[Popup] Axe verification:', verifyResult[0].result);
        
        if (!verifyResult[0].result.axeExists) {
            throw new Error('axe-core failed to load on the page - may be blocked by page security');
        }

        updateStatus('Scanning page for accessibility issues...', 40);
        console.log('[Popup] Starting accessibility scan...');

        // Use content script approach for better compatibility
        await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            function: setupAndRunValidation
        });

        updateStatus('Processing scan results...', 60);
        console.log('[Popup] Waiting for scan to complete...');

        // Wait for results via message passing
        const results = await waitForValidationViaMessages(tab.id, 95000);
        console.log('[Popup] ✓ Results received:', results);

        updateStatus('Processing results...', 90);
        lastResults = results;
        displayResults(results);

    } catch (error) {
        console.error('[Popup] ❌ Validation error:', error);
        
        let errorMessage = error.message;
        if (errorMessage.includes('Cannot access')) {
            errorMessage = 'Cannot access this page. It may be a system page (chrome://, about:, etc.)';
        } else if (errorMessage.includes('timeout')) {
            errorMessage = 'Validation timed out. The page may have security restrictions preventing scanning. Try a different page.';
        } else if (errorMessage.includes('No results')) {
            errorMessage = 'No validation results received. The page may be blocking axe-core execution.';
        } else if (errorMessage.includes('failed to load')) {
            errorMessage = 'axe-core failed to load. This page has security restrictions that prevent the scanner from running.';
        }
        
        showError(errorMessage);
    } finally {
        isValidating = false;
        validateBtn.disabled = false;
        statusDiv.classList.add('hidden');
        console.log('===== WCAG VALIDATION END =====');
    }
}

// Wait for page to be fully ready
function waitForPageReady() {
    return new Promise((resolve) => {
        console.log('[Page] Waiting for page readiness, current state:', document.readyState);
        
        if (document.readyState === 'complete' || document.readyState === 'interactive') {
            console.log('[Page] Page already ready');
            // Still wait a bit for dynamic content
            setTimeout(resolve, 2000);
            return;
        }
        
        document.addEventListener('readystatechange', () => {
            console.log('[Page] Ready state changed to:', document.readyState);
            if (document.readyState === 'complete') {
                console.log('[Page] Document complete, waiting for settles...');
                setTimeout(resolve, 3000);
            }
        });
        
        window.addEventListener('load', () => {
            console.log('[Page] Window load event fired');
            setTimeout(resolve, 2000);
        });
        
        // Fallback timeout
        setTimeout(() => {
            console.log('[Page] Timeout reached, proceeding anyway');
            resolve();
        }, 15000);
    });
}

// Setup and run validation directly in page context
function setupAndRunValidation() {
    console.log('[Page] ===== SETUP AND RUN VALIDATION =====');
    
    // Initialize storage
    window.wcagValidationResults = null;
    window.wcagCallbackFired = false;
    window.wcagDebugLogs = [];
    
    function addDebugLog(msg) {
        window.wcagDebugLogs.push('[' + new Date().toISOString() + '] ' + msg);
        console.log('[Page Debug]', msg);
    }
    
    addDebugLog('Initialization started');
    addDebugLog('Document state: ' + document.readyState);
    addDebugLog('DOM elements: ' + document.querySelectorAll('*').length);
    
    // ===== DIAGNOSTIC CHECKS =====
    addDebugLog('=== DIAGNOSTIC CHECKS ===');
    
    // Check for iframes
    const iframes = document.querySelectorAll('iframe');
    addDebugLog('Iframes found: ' + iframes.length);
    
    // Check for shadow DOM
    const elementsWithShadow = Array.from(document.querySelectorAll('*')).filter(el => el.shadowRoot);
    addDebugLog('Elements with shadow DOM: ' + elementsWithShadow.length);
    
    // Check for common interactive elements
    const buttons = document.querySelectorAll('button, [role="button"]');
    const links = document.querySelectorAll('a');
    const inputs = document.querySelectorAll('input, textarea, select');
    const images = document.querySelectorAll('img');
    const labels = document.querySelectorAll('label');
    const headings = document.querySelectorAll('h1, h2, h3, h4, h5, h6');
    
    addDebugLog('Interactive elements:');
    addDebugLog(`  Buttons: ${buttons.length}`);
    addDebugLog(`  Links: ${links.length}`);
    addDebugLog(`  Form inputs: ${inputs.length}`);
    addDebugLog(`  Images: ${images.length}`);
    addDebugLog(`  Labels: ${labels.length}`);
    addDebugLog(`  Headings: ${headings.length}`);
    
    // ===== MANUAL ACCESSIBILITY CHECKS WITH DETAILED ELEMENT INFO =====
    addDebugLog('=== MANUAL ACCESSIBILITY CHECKS ===');
    const manualViolations = [];
    
    // Check 1: Images without alt text
    const imagesWithoutAlt = Array.from(images).filter(img => !img.alt || img.alt.trim() === '');
    if (imagesWithoutAlt.length > 0) {
        addDebugLog(`[VIOLATION] ${imagesWithoutAlt.length} images without alt text`);
        manualViolations.push({
            id: 'image-alt-text',
            description: 'Images must have descriptive alt text',
            impact: 'critical',
            nodes: imagesWithoutAlt.map(img => ({
                html: img.outerHTML.substring(0, 150),
                src: img.src || 'no src',
                class: img.className,
                id: img.id
            }))
        });
    }
    
    // Check 2: Form inputs without labels
    const inputsWithoutLabel = Array.from(inputs).filter(input => {
        // Check for aria-label
        if (input.getAttribute('aria-label')) return false;
        // Check for aria-labelledby
        if (input.getAttribute('aria-labelledby')) return false;
        // Check for associated label
        if (input.id) {
            const label = document.querySelector(`label[for="${input.id}"]`);
            if (label) return false;
        }
        // Check for parent label
        if (input.closest('label')) return false;
        
        return true;
    });
    
    if (inputsWithoutLabel.length > 0) {
        addDebugLog(`[VIOLATION] ${inputsWithoutLabel.length} form inputs without labels`);
        manualViolations.push({
            id: 'form-label',
            description: 'Form inputs must have associated labels',
            impact: 'critical',
            nodes: inputsWithoutLabel.map(inp => ({
                type: inp.type,
                name: inp.name || 'unnamed',
                id: inp.id || 'no-id',
                placeholder: inp.placeholder || 'no placeholder',
                class: inp.className,
                html: inp.outerHTML.substring(0, 150)
            }))
        });
    }
    
    // Check 3: Links without text
    const linksWithoutText = Array.from(links).filter(link => {
        const text = link.textContent?.trim();
        const ariaLabel = link.getAttribute('aria-label');
        return !text && !ariaLabel;
    });
    
    if (linksWithoutText.length > 0) {
        addDebugLog(`[VIOLATION] ${linksWithoutText.length} links without descriptive text`);
        manualViolations.push({
            id: 'link-text',
            description: 'Links must have descriptive text',
            impact: 'serious',
            nodes: linksWithoutText.map(link => ({
                href: link.href || 'no href',
                html: link.outerHTML.substring(0, 150),
                class: link.className,
                id: link.id
            }))
        });
    }
    
    // Check 4: Buttons without labels
    const buttonsWithoutText = Array.from(buttons).filter(btn => {
        const text = btn.textContent?.trim();
        const ariaLabel = btn.getAttribute('aria-label');
        return !text && !ariaLabel;
    });
    
    if (buttonsWithoutText.length > 0) {
        addDebugLog(`[VIOLATION] ${buttonsWithoutText.length} buttons without labels`);
        manualViolations.push({
            id: 'button-label',
            description: 'Buttons must have labels',
            impact: 'serious',
            nodes: buttonsWithoutText.map(btn => ({
                type: btn.type || 'button',
                class: btn.className,
                id: btn.id || 'no-id',
                html: btn.outerHTML.substring(0, 150)
            }))
        });
    }
    
    // Check 5: Heading structure
    const headingLevels = new Set();
    Array.from(headings).forEach(h => {
        const level = parseInt(h.tagName[1]);
        headingLevels.add(level);
    });
    
    if (headingLevels.size > 0) {
        const minLevel = Math.min(...headingLevels);
        if (minLevel !== 1) {
            addDebugLog(`[WARNING] Page has no H1 heading`);
            manualViolations.push({
                id: 'heading-h1',
                description: 'Page should have an H1 heading',
                impact: 'moderate',
                nodes: [{
                    message: 'No H1 heading found. First heading is: H' + minLevel
                }]
            });
        }
    } else {
        addDebugLog(`[WARNING] Page has no headings at all`);
        manualViolations.push({
            id: 'heading-structure',
            description: 'Page has no headings',
            impact: 'serious',
            nodes: [{
                message: 'Page should have a logical heading structure starting with H1'
            }]
        });
    }
    
    addDebugLog(`Manual violations found: ${manualViolations.length}`);
    
    // Check page color contrast (basic)
    try {
        const style = window.getComputedStyle(document.body);
        const bgColor = style.backgroundColor;
        const color = style.color;
        addDebugLog(`Body colors - BG: ${bgColor}, Text: ${color}`);
    } catch (e) {
        addDebugLog('Could not get computed styles: ' + e.message);
    }
    
    // Check for CSP headers
    addDebugLog('=== CSP & SECURITY ===');
    const cspMeta = document.querySelector('meta[http-equiv="Content-Security-Policy"]');
    addDebugLog('CSP Meta tag present: ' + !!cspMeta);
    
    // Check if axe exists
    if (typeof window.axe === 'undefined') {
        addDebugLog('ERROR: axe-core not found in window');
        window.wcagValidationResults = {
            error: 'axe-core library not loaded',
            debug: window.wcagDebugLogs
        };
        return;
    }
    
    addDebugLog('=== AXE SCAN START ===');
    addDebugLog('axe-core found, version: ' + window.axe.version);
    
    const scanStartTime = Date.now();
    addDebugLog('Starting axe.run() with WCAG 2.0 AA...');
    
    try {
        window.axe.run(
            { 
                runOnly: { type: 'tag', values: ['wcag2aa'] },
                resultTypes: ['violations', 'passes', 'incomplete', 'inapplicable']
            },
            (error, results) => {
                const elapsedTime = Date.now() - scanStartTime;
                addDebugLog('=== AXE CALLBACK EXECUTED ===');
                addDebugLog('Callback executed after ' + elapsedTime + 'ms');
                window.wcagCallbackFired = true;
                
                if (error) {
                    addDebugLog('ERROR in callback: ' + (error.message || JSON.stringify(error)));
                    window.wcagValidationResults = {
                        error: error.message || 'Unknown error',
                        success: false,
                        debug: window.wcagDebugLogs
                    };
                } else {
                    const summary = {
                        violations: results.violations?.length || 0,
                        passes: results.passes?.length || 0,
                        incomplete: results.incomplete?.length || 0,
                        inapplicable: results.inapplicable?.length || 0
                    };
                    addDebugLog('Scan completed: ' + JSON.stringify(summary));
                    
                    // Combine axe violations with manual violations
                    const allViolations = [...(results.violations || []), ...manualViolations];
                    
                    if (allViolations.length > 0) {
                        addDebugLog(`=== ALL VIOLATIONS FOUND (${allViolations.length}) ===`);
                        allViolations.forEach((v, i) => {
                            addDebugLog(`${i + 1}. ${v.id} - ${v.nodes?.length || 'multiple'} issues`);
                        });
                    } else {
                        addDebugLog('No violations found');
                    }
                    
                    if (results.incomplete?.length > 0) {
                        addDebugLog('=== INCOMPLETE CHECKS (Manual Review Needed) ===');
                        results.incomplete.forEach((v, i) => {
                            addDebugLog(`${i + 1}. ${v.id} (${v.nodes?.length || 0} elements)`);
                        });
                    }
                    
                    window.wcagValidationResults = {
                        violations: allViolations,
                        passes: results.passes || [],
                        incomplete: results.incomplete || [],
                        inapplicable: results.inapplicable || [],
                        timestamp: new Date().toISOString(),
                        url: window.location.href,
                        pageInfo: {
                            title: document.title,
                            elementsScanned: document.querySelectorAll('*').length,
                            readyState: document.readyState,
                            iframes: document.querySelectorAll('iframe').length
                        },
                        success: true,
                        debug: window.wcagDebugLogs
                    };
                }
                
                addDebugLog('=== CALLBACK END ===');
                
                // Send message to extension
                try {
                    chrome.runtime.sendMessage({
                        action: 'validationComplete',
                        data: window.wcagValidationResults
                    });
                } catch (e) {
                    addDebugLog('Could not send message: ' + e.message);
                }
            }
        );
        
        addDebugLog('axe.run() called successfully, waiting for callback...');
        
    } catch (e) {
        addDebugLog('EXCEPTION in axe.run(): ' + e.message);
        console.error('[Page]', e);
        window.wcagValidationResults = {
            error: 'Exception: ' + e.message,
            success: false,
            debug: window.wcagDebugLogs
        };
    }
}

// Wait for validation results via message passing
function waitForValidationViaMessages(tabId, timeoutMs) {
    return new Promise((resolve, reject) => {
        let messageReceived = false;
        let pollAttempts = 0;
        const maxPollAttempts = 180;
        
        // Listen for message from content script
        const messageListener = (message, sender, sendResponse) => {
            if (sender.tab?.id === tabId && message.action === 'validationComplete') {
                console.log('[Popup] ✓ Message received from page');
                messageReceived = true;
                
                if (message.data?.error) {
                    reject(new Error(message.data.error));
                } else {
                    resolve(message.data);
                }
            }
        };
        
        chrome.runtime.onMessage.addListener(messageListener);
        
        // Also poll in case message doesn't arrive
        const pollInterval = setInterval(async () => {
            pollAttempts++;
            
            if (messageReceived) {
                clearInterval(pollInterval);
                chrome.runtime.onMessage.removeListener(messageListener);
                return;
            }
            
            try {
                const results = await chrome.scripting.executeScript({
                    target: { tabId: tabId },
                    function: () => ({
                        results: window.wcagValidationResults,
                        callbackFired: window.wcagCallbackFired,
                        axeLoaded: typeof window.axe !== 'undefined',
                        debug: window.wcagDebugLogs
                    })
                });
                
                const { results: data, callbackFired, debug } = results[0].result;
                
                if (pollAttempts % 20 === 1) {
                    console.log(`[Popup] Poll attempt ${pollAttempts}/${maxPollAttempts}:`, {
                        callbackFired,
                        hasResults: !!data,
                        debugLogsCount: debug?.length || 0
                    });
                    if (debug && debug.length > 0) {
                        console.log('[Popup] Latest debug logs:', debug.slice(-3));
                    }
                }
                
                if (data && callbackFired && data.success !== false && pollAttempts >= 10) {
                    console.log('[Popup] ✓ Valid results found via polling on attempt', pollAttempts);
                    console.log('[Popup] Page info:', data.pageInfo);
                    clearInterval(pollInterval);
                    chrome.runtime.onMessage.removeListener(messageListener);
                    
                    if (data.error) {
                        reject(new Error(data.error));
                    } else {
                        resolve(data);
                    }
                    return;
                }
                
                if (pollAttempts >= maxPollAttempts) {
                    clearInterval(pollInterval);
                    chrome.runtime.onMessage.removeListener(messageListener);
                    
                    let detailedError = 'Validation timeout after 90 seconds.';
                    if (debug && debug.length > 0) {
                        detailedError += ' Debug logs: ' + debug.slice(-5).join(' | ');
                    }
                    
                    reject(new Error(detailedError));
                }
            } catch (e) {
                console.error(`[Popup] ❌ Poll error on attempt ${pollAttempts}:`, e.message);
            }
        }, 500);
        
        // Overall timeout
        setTimeout(() => {
            clearInterval(pollInterval);
            chrome.runtime.onMessage.removeListener(messageListener);
            console.error('[Popup] ❌ Overall timeout reached');
            reject(new Error('Validation timeout'));
        }, timeoutMs);
    });
}

function updateStatus(message, progress) {
    statusDiv.innerHTML = `
        <div class="spinner"></div>
        <p>${message}</p>
        <div class="progress-bar">
            <div class="progress-fill" style="width: ${progress}%"></div>
        </div>
        <small style="color: #999; margin-time: 10px;">Progress: ${progress}%</small>
        <button id="cancelBtn" class="btn btn-cancel">Cancel</button>
    `;

    const cancelBtn = document.getElementById('cancelBtn');
    if (cancelBtn) {
        cancelBtn.addEventListener('click', () => {
            isValidating = false;
            validateBtn.disabled = false;
            statusDiv.classList.add('hidden');
            welcomeDiv.classList.remove('hidden');
        });
    }
}

function showError(message) {
    resultsDiv.classList.add('hidden');
    welcomeDiv.classList.add('hidden');
    statusDiv.classList.remove('hidden');
    statusDiv.innerHTML = `<p style="color: red; padding: 20px; text-align: center; font-size: 13px; line-height: 1.6;">${message}</p>`;
    
    setTimeout(() => {
        statusDiv.classList.add('hidden');
        welcomeDiv.classList.remove('hidden');
    }, 8000);
}

function displayResults(results) {
    console.log('[Popup] Displaying results:', results);
    resultsDiv.classList.remove('hidden');
    welcomeDiv.classList.add('hidden');

    const { violations = [], passes = [], incomplete = [] } = results;
    const totalIssues = violations.length + incomplete.length;

    console.log('[Popup] Total issues to display:', { violations: violations.length, incomplete: incomplete.length, total: totalIssues });

    scoreDisplay.textContent = totalIssues;
    const scoreCard = document.querySelector('.score-card');
    if (totalIssues === 0) {
        console.log('[Popup] No issues found - marking as COMPLIANT');
        scoreCard.classList.add('success');
        scoreCard.innerHTML = '<div class="score">✓</div><div class="label">Compliant</div>';
    } else {
        console.log('[Popup] Issues found - marking as NON-COMPLIANT');
        scoreCard.classList.remove('success');
    }

    issuesListDiv.innerHTML = '';

    violations.forEach(violation => {
        const issueEl = createIssueElement(violation, 'violation');
        issuesListDiv.appendChild(issueEl);
    });

    incomplete.forEach(item => {
        const issueEl = createIssueElement(item, 'needs-review');
        issuesListDiv.appendChild(issueEl);
    });

    if (passes.length > 0) {
        const passEl = document.createElement('div');
        passEl.className = 'issue pass';
        passEl.innerHTML = `<div class="issue-title">✓ ${passes.length} Checks Passed</div>`;
        issuesListDiv.appendChild(passEl);
    }

    reportBtn.disabled = false;
}

function createIssueElement(violation, type) {
    const el = document.createElement('div');
    el.className = `issue ${type}`;

    const title = document.createElement('div');
    title.className = 'issue-title';
    title.textContent = violation.id.toUpperCase();

    const description = document.createElement('div');
    description.className = 'issue-description';
    description.textContent = violation.description || violation.help || 'Accessibility issue detected';

    const helpText = document.createElement('div');
    helpText.className = 'issue-help';
    
    // Handle both axe violations and manual violations
    if (violation.help) {
        helpText.innerHTML = `<strong>How to fix:</strong> ${violation.help}`;
    } else if (violation.id === 'form-label') {
        helpText.innerHTML = `<strong>How to fix:</strong> Associate every form input with a <code>&lt;label&gt;</code> element using the 'for' attribute, or use 'aria-label' / 'aria-labelledby' attributes.`;
    } else if (violation.id === 'link-text') {
        helpText.innerHTML = `<strong>How to fix:</strong> Ensure all links have descriptive text content. Avoid "click here" or "read more" - use text that describes the link destination.`;
    } else if (violation.id === 'button-label') {
        helpText.innerHTML = `<strong>How to fix:</strong> Ensure all buttons have visible text labels or use 'aria-label' attributes to describe their purpose.`;
    } else if (violation.id === 'image-alt-text') {
        helpText.innerHTML = `<strong>How to fix:</strong> Add descriptive alt text to all images using the 'alt' attribute. For decorative images, use alt=""`;
    } else if (violation.id === 'heading-h1') {
        helpText.innerHTML = `<strong>How to fix:</strong> Every page should have exactly one H1 heading that describes the main purpose of the page.`;
    } else if (violation.id === 'heading-structure') {
        helpText.innerHTML = `<strong>How to fix:</strong> Add a logical heading structure starting with H1, followed by H2, H3, etc.`;
    }

    el.appendChild(title);
    el.appendChild(description);
    el.appendChild(helpText);

    // Show affected elements count and list them
    const nodeCount = violation.nodes?.length || 0;
    
    if (nodeCount > 0) {
        const count = document.createElement('div');
        count.style.fontSize = '12px';
        count.style.color = '#999';
        count.style.marginTop = '8px';
        count.style.marginBottom = '8px';
        count.textContent = `Found in ${nodeCount} element(s)`;
        el.appendChild(count);
        
        // Show list of affected elements
        const nodesList = document.createElement('div');
        nodesList.style.fontSize = '11px';
        nodesList.style.backgroundColor = '#f5f5f5';
        nodesList.style.padding = '8px';
        nodesList.style.borderRadius = '4px';
        nodesList.style.maxHeight = '200px';
        nodesList.style.overflowY = 'auto';
        nodesList.style.marginTop = '4px';
        
        const itemsToShow = Math.min(5, nodeCount);
        const showMore = nodeCount > 5;
        
        violation.nodes.slice(0, itemsToShow).forEach((node, index) => {
            const itemEl = document.createElement('div');
            itemEl.style.marginBottom = '4px';
            itemEl.style.paddingBottom = '4px';
            itemEl.style.borderBottom = '1px solid #ddd';
            
            let content = '';
            
            if (typeof node === 'string') {
                content = `${index + 1}. ${node}`;
            } else if (node.message) {
                content = `${index + 1}. ${node.message}`;
            } else if (node.html) {
                content = `${index + 1}. ${node.html.substring(0, 80)}...`;
            } else if (node.id || node.name || node.type) {
                content = `${index + 1}. `;
                if (node.id) content += `id="${node.id}" `;
                if (node.name) content += `name="${node.name}" `;
                if (node.type) content += `type="${node.type}"`;
                if (node.href) content += `href="${node.href}"`;
            } else if (node.src) {
                content = `${index + 1}. src="${node.src}"`;
            } else {
                content = `${index + 1}. ${JSON.stringify(node).substring(0, 80)}`;
            }
            
            itemEl.textContent = content;
            nodesList.appendChild(itemEl);
        });
        
        if (showMore) {
            const moreEl = document.createElement('div');
            moreEl.style.fontStyle = 'italic';
            moreEl.style.color = '#666';
            moreEl.style.paddingTop = '4px';
            moreEl.textContent = `... and ${nodeCount - itemsToShow} more`;
            nodesList.appendChild(moreEl);
        }
        
        el.appendChild(nodesList);
    }

    return el;
}

function showDetailedReport() {
    if (!lastResults) {
        console.log('[Popup] No results to report');
        return;
    }
    
    console.log('[Popup] Opening detailed report with results');
    chrome.runtime.sendMessage({ 
        action: 'openReport', 
        results: lastResults 
    }, (response) => {
        console.log('[Popup] Report message sent');
    });
}
