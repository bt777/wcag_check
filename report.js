console.log('[Report] Report page loaded');

const tabs = document.querySelectorAll('.tab-btn');
const tabContents = document.querySelectorAll('.tab-content');

tabs.forEach(tab => {
    tab.addEventListener('click', (e) => {
        const tabName = e.target.dataset.tab;
        showTab(tabName);
    });
});

function showTab(tabName) {
    tabs.forEach(t => t.classList.remove('active'));
    tabContents.forEach(c => c.classList.remove('active'));

    document.querySelector(`[data-tab="${tabName}"]`).classList.add('active');
    document.getElementById(tabName).classList.add('active');
}

// Load and display results from session storage
console.log('[Report] Fetching validation results from storage');

chrome.storage.session.get('lastValidationResults', (data) => {
    console.log('[Report] Storage data:', data);
    
    if (data && data.lastValidationResults) {
        const results = data.lastValidationResults;
        console.log('[Report] Results found:', {
            violations: results.violations ? results.violations.length : 0,
            passes: results.passes ? results.passes.length : 0,
            incomplete: results.incomplete ? results.incomplete.length : 0
        });

        // Update header
        document.getElementById('url').textContent = results.url || 'Unknown URL';
        document.getElementById('timestamp').textContent = results.timestamp 
            ? new Date(results.timestamp).toLocaleString() 
            : 'Unknown time';

        // Display violations
        displayIssues(results.violations || [], 'violationsList', 'violation');

        // Display incomplete
        displayIssues(results.incomplete || [], 'incompleteList', 'incomplete');

        // Display passes
        displayIssues(results.passes || [], 'passesList', 'pass');
    } else {
        console.error('[Report] No validation results found in storage');
        document.getElementById('violationsList').innerHTML = '<div class="empty">No results found. Please run validation again.</div>';
        document.getElementById('incompleteList').innerHTML = '<div class="empty">No results found.</div>';
        document.getElementById('passesList').innerHTML = '<div class="empty">No results found.</div>';
    }
});

function displayIssues(issues, containerId, type) {
    const container = document.getElementById(containerId);
    console.log(`[Report] Displaying ${issues.length} issues in ${containerId}`);

    if (issues.length === 0) {
        container.innerHTML = '<div class="empty">No issues found.</div>';
        return;
    }

    container.innerHTML = issues.map(issue => `
        <div class="issue-card ${type}">
            <div class="issue-id">${issue.id || 'UNKNOWN'}</div>
            <div class="issue-title">${issue.title || issue.help || 'Untitled'}</div>
            <div class="issue-description">${issue.description || ''}</div>
            ${issue.impact ? `<div class="issue-impact"><strong>Impact:</strong> ${issue.impact}</div>` : ''}
            <div class="issue-help"><strong>Recommendation:</strong> ${issue.help || 'No help text available'}</div>
            ${issue.nodes && issue.nodes.length > 0 ? `
                <div class="affected-elements">
                    <h4>Affected Elements (${issue.nodes.length})</h4>
                    ${issue.nodes.map(node => `
                        <div class="element">${escapeHtml(node.html || 'No HTML available')}</div>
                    `).join('')}
                </div>
            ` : ''}
        </div>
    `).join('');
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}