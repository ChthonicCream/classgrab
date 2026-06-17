chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
    const currentTab = tabs[0];
    if (!currentTab.url.startsWith('https://classroom.google.com/')) {
        document.body.innerHTML = `
            <div class="unsupported-container">
                <div class="unsupported-icon">🔒</div>
                <h2>Not Google Classroom</h2>
                <p>This extension only works on Google Classroom pages. Please navigate to Google Classroom to use ClassGrab.</p>
                <a href="https://classroom.google.com" target="_blank" class="primary-btn accent-btn center-btn">Open Classroom</a>
            </div>
        `;
        return;
    }

    // Extract the authuser parameter from the Classroom URL (defaults to 0 if not found)
    const authuserMatch = currentTab.url.match(/\/u\/(\d+)\//);
    const authuser = authuserMatch ? authuserMatch[1] : '0';

    // Helper function to safely append authuser to the download link
    const appendAuthUser = (url) => {
        const separator = url.includes('?') ? '&' : '?';
        return `${url}${separator}authuser=${authuser}`;
    };

    chrome.tabs.sendMessage(tabs[0].id, { action: "getDriveLinks" }, function (response) {
        const fileList = document.getElementById('fileList');
        
        if (response && response.files.length > 0) {
            fileList.innerHTML = ''; // Clear previous text
            
            response.files.forEach(file => {
                const li = document.createElement('li');
                li.className = 'file-item';

                // Custom checkbox container
                const checkboxWrapper = document.createElement('label');
                checkboxWrapper.className = 'checkbox-container';
                
                const checkbox = document.createElement('input');
                checkbox.type = 'checkbox';
                checkbox.className = 'file-checkbox';
                checkbox.value = file.link;
                checkbox.dataset.filename = file.name;

                const checkmark = document.createElement('span');
                checkmark.className = 'checkmark';

                checkboxWrapper.appendChild(checkbox);
                checkboxWrapper.appendChild(checkmark);

                // File icon (extract file extension)
                const nameParts = file.name.split('.');
                const ext = nameParts.length > 1 ? nameParts.pop().toLowerCase() : 'file';
                
                const iconWrapper = document.createElement('div');
                // Use default styling fallback if extension classes aren't matched
                const knownExts = ['pdf', 'doc', 'docx', 'ppt', 'pptx', 'xls', 'xlsx', 'zip', 'rar', 'jpg', 'jpeg', 'png', 'gif'];
                if (knownExts.includes(ext)) {
                    iconWrapper.className = `file-icon-wrapper ext-${ext}`;
                } else {
                    iconWrapper.className = 'file-icon-wrapper file-icon-default';
                }
                
                const iconText = document.createElement('span');
                iconText.className = 'file-icon-text';
                iconText.textContent = ext.substring(0, 3).toUpperCase();
                iconWrapper.appendChild(iconText);

                // File text
                const text = document.createElement('span');
                text.className = 'file-name';
                text.textContent = file.name;

                li.appendChild(checkboxWrapper);
                li.appendChild(iconWrapper);
                li.appendChild(text);
                fileList.appendChild(li);

                // Toggle click event on list item click
                li.addEventListener('click', function (event) {
                    if (event.target !== checkbox && !checkboxWrapper.contains(event.target)) {
                        checkbox.checked = !checkbox.checked;
                        checkbox.dispatchEvent(new Event('change'));
                    }
                });

                checkbox.addEventListener('change', function() {
                    const allChecked = Array.from(fileList.querySelectorAll('.file-checkbox')).every(cb => cb.checked);
                    document.getElementById('selectAll').checked = allChecked;
                });
            });

            // select-all toggle
            document.getElementById('selectAll').addEventListener('change', function () {
                Array.from(fileList.querySelectorAll('.file-checkbox')).forEach(cb => {
                    cb.checked = this.checked;
                });
            });

            // download action triggers
            document.getElementById('downloadSelected').addEventListener('click', function () {
                Array.from(fileList.children).forEach(li => {
                    const checkbox = li.querySelector('.file-checkbox');
                    if (checkbox && checkbox.checked) {
                        const filename = checkbox.dataset.filename;
                        console.log('Downloading:', filename, 'from:', checkbox.value);
                        chrome.downloads.download({ 
                            url: appendAuthUser(checkbox.value), 
                            filename: filename,
                            saveAs: false
                        }, function(downloadId) {
                            if (chrome.runtime.lastError) {
                                console.error('Download error:', chrome.runtime.lastError);
                            } else {
                                console.log('Download started:', downloadId);
                            }
                        });
                    }
                });
            });

            document.getElementById('downloadAll').addEventListener('click', function () {
                response.files.forEach(file => {
                    console.log('Downloading:', file.name, 'from:', file.link);
                    chrome.downloads.download({ 
                        url: appendAuthUser(file.link), 
                        filename: file.name,
                        saveAs: false
                    }, function(downloadId) {
                        if (chrome.runtime.lastError) {
                            console.error('Download error:', chrome.runtime.lastError);
                        } else {
                            console.log('Download started:', downloadId);
                        }
                    });
                });
            });

        } else {
            fileList.innerHTML = `
                <div class="empty-state">
                    No classroom attachment files found.<br>
                    Try opening a class post, assignment, or refresh the page.
                </div>
            `;
            // Disable buttons if list is empty
            document.getElementById('downloadSelected').disabled = true;
            document.getElementById('downloadAll').disabled = true;
            document.getElementById('selectAll').disabled = true;
            document.getElementById('downloadSelected').style.opacity = 0.5;
            document.getElementById('downloadAll').style.opacity = 0.5;
        }
    });
});

// Theme Toggle logic
const darkModeButton = document.getElementById("darkModeButton");
const body = document.getElementById("body");

function updateThemeUI(isDark) {
    if (isDark) {
        darkModeButton.innerHTML = `
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" class="svg-icon"><circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="M4.93 4.93l1.41 1.41"/><path d="M17.66 17.66l1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="M6.34 17.66l-1.41 1.41"/><path d="M19.07 4.93l-1.41 1.41"/></svg>
        `;
        darkModeButton.setAttribute("title", "Switch to Light Mode");
    } else {
        darkModeButton.innerHTML = `
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" class="svg-icon"><path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/></svg>
        `;
        darkModeButton.setAttribute("title", "Switch to Dark Mode");
    }
}

darkModeButton.addEventListener('click', function() {
    const isDark = body.classList.toggle("dm");
    localStorage.setItem("theme", isDark ? "dark" : "light");
    updateThemeUI(isDark);
});

// Initialize Theme
const savedTheme = localStorage.getItem("theme");
const systemPrefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
const shouldBeDark = savedTheme === "dark" || (!savedTheme && systemPrefersDark);

if (shouldBeDark) {
    body.classList.add("dm");
    updateThemeUI(true);
} else {
    body.classList.remove("dm");
    updateThemeUI(false);
}
