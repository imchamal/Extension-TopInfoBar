const {
    eventSource,
    event_types,
    getCurrentChatId,
    renameChat,
    getRequestHeaders,
    openGroupChat,
    openCharacterChat,
    executeSlashCommandsWithOptions,
    Popup,
} = SillyTavern.getContext();
import { addJQueryHighlight } from './jquery-highlight.js';
import { getGroupPastChats } from '../../../group-chats.js';
import { getPastCharacterChats, animation_duration, animation_easing, getGeneratingApi } from '../../../../script.js';
import { debounce, timestampToMoment, sortMoments, uuidv4, waitUntilCondition } from '../../../utils.js';
import { debounce_timeout } from '../../../constants.js';
import { t } from '../../../i18n.js';

const movingDivs = /** @type {HTMLDivElement} */ (document.getElementById('movingDivs'));
const sheld = /** @type {HTMLDivElement} */ (document.getElementById('sheld'));
const chat = /** @type {HTMLDivElement} */ (document.getElementById('chat'));
const draggableTemplate = /** @type {HTMLTemplateElement} */ (document.getElementById('generic_draggable_template'));
const apiBlock = /** @type {HTMLDivElement} */ (document.getElementById('rm_api_block'));

const topBar = document.createElement('div');
const chatName = document.createElement('select');
const connectionProfiles = document.createElement('div');
const connectionProfilesStatus = document.createElement('div');
const connectionProfilesSelect = document.createElement('select');
const connectionProfilesIcon = document.createElement('img');
const SEARCH_HIGHLIGHT_CLASS = 'extensionTopBarSearchHighlight';
const SEARCH_CURRENT_CLASS = 'current';
const searchHighlightOptions = { element: 'mark', className: SEARCH_HIGHLIGHT_CLASS };
const searchPanel = document.createElement('div');
const searchState = {
    query: '',
    replace: '',
    matches: [],
    currentIndex: -1,
    caseSensitive: false,
    wholeWord: false,
    controls: {},
};

const icons = [
    {
        id: 'extensionTopBarToggleSidebar',
        icon: 'fa-fw fa-solid fa-box-archive',
        position: 'left',
        title: t`Toggle sidebar`,
        onClick: onToggleSidebarClick,
    },
    {
        id: 'extensionTopBarToggleConnectionProfiles',
        icon: 'fa-fw fa-solid fa-plug',
        position: 'left',
        title: t`Show connection profiles`,
        isTemporaryAllowed: true,
        onClick: onToggleConnectionProfilesClick,
    },
    {
        id: 'extensionTopBarSearch',
        icon: 'fa-fw fa-solid fa-magnifying-glass',
        position: 'right',
        title: t`Search and replace`,
        isTemporaryAllowed: true,
        onClick: onSearchClick,
    },
    {
        id: 'extensionTopBarChatManager',
        icon: 'fa-fw fa-solid fa-address-book',
        position: 'right',
        title: t`View chat files`,
        isTemporaryAllowed: true,
        onClick: onChatManagerClick,
    },
    {
        id: 'extensionTopBarNewChat',
        icon: 'fa-fw fa-solid fa-comments',
        position: 'right',
        title: t`New chat`,
        isTemporaryAllowed: true,
        onClick: onNewChatClick,
    },
    {
        id: 'extensionTopBarRenameChat',
        icon: 'fa-fw fa-solid fa-edit',
        position: 'right',
        title: t`Rename chat`,
        onClick: onRenameChatClick,
    },
    {
        id: 'extensionTopBarDeleteChat',
        icon: 'fa-fw fa-solid fa-trash',
        position: 'right',
        title: t`Delete chat`,
        onClick: async () => {
            const confirm = await Popup.show.confirm(t`Are you sure?`);
            if (confirm) {
                await executeSlashCommandsWithOptions('/delchat');
            }
        },
    },
    {
        id: 'extensionTopBarCloseChat',
        icon: 'fa-fw fa-solid fa-times',
        position: 'right',
        title: t`Close chat`,
        isTemporaryAllowed: true,
        onClick: onCloseChatClick,
    },
];

function onChatManagerClick() {
    document.getElementById('option_select_chat')?.click();
}

function onCloseChatClick() {
    document.getElementById('option_close_chat')?.click();
}

function onNewChatClick() {
    document.getElementById('option_start_new_chat')?.click();
}

async function onRenameChatClick() {
    const currentChatName = getCurrentChatId();

    if (!currentChatName) {
        return;
    }

    const newChatName = await Popup.show.input(t`Enter new chat name`, null, currentChatName);

    if (!newChatName || newChatName === currentChatName) {
        return;
    }

    await renameChat(currentChatName, String(newChatName));
}

function patchSheldIfNeeded() {
    // Fun fact: sheld is a typo. It should be shell.
    // It was fixed in OG TAI long ago, but we still have it here.
    if (!sheld) {
        console.error('Sheld not found. Did you finally rename it?');
        return;
    }

    const computedStyle = getComputedStyle(sheld);
    // Alert: We're not in a version that switched sheld to flex yet.
    if (computedStyle.display === 'grid') {
        sheld.classList.add('flexPatch');
    }
}

function setChatName(name) {
    const isNotInChat = !name;
    chatName.innerHTML = '';
    const selectedOption = document.createElement('option');
    selectedOption.innerText = name || t`No chat selected`;
    selectedOption.selected = true;
    chatName.appendChild(selectedOption);
    chatName.disabled = true;

    icons.forEach(icon => {
        const iconElement = document.getElementById(icon.id);
        if (iconElement) {
            iconElement.classList.toggle('not-in-chat', isNotInChat && !icon.isTemporaryAllowed);
        }
    });

    if (!isNotInChat && typeof openGroupChat === 'function' && typeof openCharacterChat === 'function') {
        setTimeout(async () => {
            const list = [];
            const context = SillyTavern.getContext();
            if (context.groupId) {
                const group = context.groups.find(x => x.id == context.groupId);
                if (group) {
                    list.push(...group.chats);
                }
            }
            else {
                const characterAvatar = context.characters[context.characterId]?.avatar;
                list.push(...await getListOfCharacterChats(characterAvatar));
            }

            if (list.length > 0) {
                chatName.innerHTML = '';
                list.sort((a, b) => a.localeCompare(b)).forEach((x) => {
                    const option = document.createElement('option');
                    option.innerText = x;
                    option.value = x;
                    option.selected = x === name;

                    chatName.appendChild(option);
                });
                chatName.disabled = false;
            }

            await populateSideBar();
        }, 0);
    }

    if (isNotInChat) {
        setTimeout(() => populateSideBar(), 0);
    }
}

/**
 * Get list of chat names for a character.
 * @param {string} avatar Avatar name of the character
 * @returns {Promise<string[]>} List of chat names
 */
async function getListOfCharacterChats(avatar) {
    try {
        const result = await fetch('/api/characters/chats', {
            method: 'POST',
            headers: getRequestHeaders(),
            body: JSON.stringify({ avatar_url: avatar, simple: true }),
        });

        if (!result.ok) {
            return [];
        }

        const data = await result.json();
        return data.map(x => String(x.file_name).replace('.jsonl', ''));
    } catch (error) {
        console.error('Failed to get list of character chats', error);
        return [];
    }
}

async function getChatFiles() {
    const context = SillyTavern.getContext();
    const chatId = getCurrentChatId();

    if (!chatId) {
        return [];
    }

    if (context.groupId) {
        return await getGroupPastChats(context.groupId);
    }

    if (context.characterId !== undefined) {
        return await getPastCharacterChats(context.characterId);
    }

    return [];
}

/**
 * Escape regex special characters in a literal search query.
 * @param {string} value String to escape
 * @returns {string} Escaped string
 */
function escapeRegExp(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Build a global regular expression from the current search state.
 * @returns {RegExp|null} Search regex
 */
function buildSearchRegex() {
    if (!searchState.query) {
        return null;
    }

    const flags = searchState.caseSensitive ? 'g' : 'gi';
    const source = escapeRegExp(searchState.query);
    const pattern = searchState.wholeWord ? `\\b${source}\\b` : source;
    return new RegExp(pattern, flags);
}

/**
 * Collect current panel input values into the search state.
 * @returns {void}
 */
function readSearchControls() {
    const controls = searchState.controls;
    searchState.query = controls.queryInput?.value.trim() ?? '';
    searchState.replace = controls.replaceInput?.value ?? '';
    searchState.caseSensitive = Boolean(controls.caseSensitiveInput?.checked);
    searchState.wholeWord = Boolean(controls.wholeWordInput?.checked);
}

/**
 * Get the saved message text that should be searched and replaced.
 * @param {object} message Chat message object
 * @returns {string} Message text
 */
function getMessageSearchText(message) {
    return typeof message?.mes === 'string' ? message.mes : '';
}

/**
 * Rebuild match indexes from the saved chat data.
 * @param {number} preferredIndex Preferred active match index
 * @returns {void}
 */
function rebuildSearchMatches(preferredIndex = 0) {
    const regex = buildSearchRegex();
    const context = SillyTavern.getContext();
    searchState.matches = [];

    if (!regex || !Array.isArray(context.chat)) {
        searchState.currentIndex = -1;
        return;
    }

    context.chat.forEach((message, messageId) => {
        const text = getMessageSearchText(message);
        let match;
        let occurrenceIndex = 0;

        regex.lastIndex = 0;
        while ((match = regex.exec(text)) !== null) {
            if (!match[0]) {
                regex.lastIndex += 1;
                continue;
            }

            searchState.matches.push({
                messageId,
                occurrenceIndex,
                start: match.index,
                end: match.index + match[0].length,
            });
            occurrenceIndex += 1;
        }
    });

    if (searchState.matches.length === 0) {
        searchState.currentIndex = -1;
        return;
    }

    searchState.currentIndex = Math.min(Math.max(preferredIndex, 0), searchState.matches.length - 1);
}

/**
 * Remove active search highlighting from currently rendered messages.
 * @returns {void}
 */
function clearSearchHighlights() {
    jQuery(chat).find('.mes_text').unhighlight(searchHighlightOptions);
}

/**
 * Assign stable search indexes to the visible highlight nodes.
 * @returns {void}
 */
function syncSearchHighlightIndexes() {
    const perMessageCounts = new Map();
    const marks = chat.querySelectorAll(`.mes_text mark.${SEARCH_HIGHLIGHT_CLASS}`);

    marks.forEach(mark => {
        const messageElement = mark.closest('.mes');
        const messageId = Number(messageElement?.getAttribute('mesid'));
        if (!Number.isFinite(messageId)) {
            return;
        }

        const occurrenceIndex = perMessageCounts.get(messageId) ?? 0;
        const matchIndex = searchState.matches.findIndex(match => match.messageId === messageId && match.occurrenceIndex === occurrenceIndex);
        if (matchIndex !== -1) {
            mark.dataset.topbarSearchIndex = String(matchIndex);
        }
        perMessageCounts.set(messageId, occurrenceIndex + 1);
    });
}

/**
 * Highlight matches in currently rendered messages.
 * @returns {void}
 */
function applySearchHighlights() {
    clearSearchHighlights();

    if (!searchState.query) {
        return;
    }

    const messages = jQuery(chat).find('.mes_text');
    messages.highlight(searchState.query, {
        ...searchHighlightOptions,
        caseSensitive: searchState.caseSensitive,
        wordsOnly: searchState.wholeWord,
    });
    syncSearchHighlightIndexes();
}

/**
 * Update the search panel status text and button enabled states.
 * @returns {void}
 */
function updateSearchStatus() {
    const controls = searchState.controls;
    const hasMatches = searchState.matches.length > 0;
    const canReplace = hasMatches && searchState.query.length > 0;

    if (controls.status) {
        if (!searchState.query) {
            controls.status.textContent = '0 / 0';
        } else if (!hasMatches) {
            controls.status.textContent = '0 / 0';
        } else {
            controls.status.textContent = `${searchState.currentIndex + 1} / ${searchState.matches.length}`;
        }
    }

    for (const button of [controls.previousButton, controls.nextButton, controls.replaceCurrentButton]) {
        setCommandDisabled(button, !canReplace);
    }
    setCommandDisabled(controls.replaceAllButton, !canReplace);
}

/**
 * Enable or disable a popup command element.
 * @param {HTMLElement} element Command element
 * @param {boolean} disabled Disabled state
 * @returns {void}
 */
function setCommandDisabled(element, disabled) {
    if (!element) {
        return;
    }

    element.setAttribute('aria-disabled', String(disabled));
    element.classList.toggle('disabled', disabled);
}

/**
 * Return the first rendered message id.
 * @returns {number} First rendered message id
 */
function getFirstRenderedMessageId() {
    const ids = Array.from(chat.querySelectorAll('.mes'))
        .map(element => Number(element.getAttribute('mesid')))
        .filter(Number.isFinite);

    return ids.length ? Math.min(...ids) : Number.NaN;
}

/**
 * Ensure a target message exists in the current DOM before focusing a match.
 * @param {number} messageId Message id
 * @returns {Promise<HTMLElement|null>} Rendered message element
 */
async function ensureMessageRendered(messageId) {
    let messageElement = chat.querySelector(`.mes[mesid="${messageId}"]`);
    if (messageElement instanceof HTMLElement) {
        return messageElement;
    }

    let renderedMoreMessages = false;
    const firstRenderedMessageId = getFirstRenderedMessageId();
    if (Number.isFinite(firstRenderedMessageId) && messageId < firstRenderedMessageId) {
        const module = await import('../../../../script.js');
        if (typeof module.showMoreMessages === 'function') {
            await module.showMoreMessages(firstRenderedMessageId - messageId);
            renderedMoreMessages = true;
        }
    }

    if (!renderedMoreMessages) {
        const context = SillyTavern.getContext();
        if (typeof context.printMessages === 'function') {
            await context.printMessages();
        }
    }

    messageElement = chat.querySelector(`.mes[mesid="${messageId}"]`);
    return messageElement instanceof HTMLElement ? messageElement : null;
}

/**
 * Move the visible focus to the active search result.
 * @param {object} [options] Options
 * @param {boolean} [options.setDomFocus=false] Move browser focus to the mark element
 * @returns {Promise<void>}
 */
async function focusCurrentMatch({ setDomFocus = false } = {}) {
    const match = searchState.matches[searchState.currentIndex];
    if (!match) {
        updateSearchStatus();
        return;
    }

    const messageElement = await ensureMessageRendered(match.messageId);
    applySearchHighlights();

    chat.querySelectorAll(`mark.${SEARCH_HIGHLIGHT_CLASS}.${SEARCH_CURRENT_CLASS}`).forEach(mark => {
        mark.classList.remove(SEARCH_CURRENT_CLASS);
    });

    const currentMark = chat.querySelector(`mark.${SEARCH_HIGHLIGHT_CLASS}[data-topbar-search-index="${searchState.currentIndex}"]`);
    if (currentMark instanceof HTMLElement) {
        currentMark.classList.add(SEARCH_CURRENT_CLASS);
        currentMark.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' });
        if (setDomFocus) {
            currentMark.tabIndex = -1;
            currentMark.focus({ preventScroll: true });
        }
    } else if (messageElement) {
        messageElement.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' });
    }

    updateSearchStatus();
}

/**
 * Refresh matches and highlights from current popup controls.
 * @param {object} [options] Options
 * @param {boolean} [options.preserveIndex=false] Keep the current match index where possible
 * @param {boolean} [options.setDomFocus=false] Move browser focus to the current match
 * @returns {Promise<void>}
 */
async function refreshSearch({ preserveIndex = false, setDomFocus = false } = {}) {
    const preferredIndex = preserveIndex ? searchState.currentIndex : 0;
    readSearchControls();
    rebuildSearchMatches(preferredIndex);
    applySearchHighlights();
    await focusCurrentMatch({ setDomFocus });
}

const searchRefreshDebounced = debounce(() => refreshSearch({ preserveIndex: false }), 250);

/**
 * Move to the previous or next match.
 * @param {number} delta Direction delta
 * @returns {Promise<void>}
 */
async function moveSearchMatch(delta) {
    readSearchControls();
    rebuildSearchMatches(searchState.currentIndex);

    if (searchState.matches.length === 0) {
        applySearchHighlights();
        updateSearchStatus();
        return;
    }

    searchState.currentIndex += delta;
    if (searchState.currentIndex < 0) {
        searchState.currentIndex = searchState.matches.length - 1;
    }
    if (searchState.currentIndex >= searchState.matches.length) {
        searchState.currentIndex = 0;
    }

    await focusCurrentMatch({ setDomFocus: true });
}

/**
 * Set a message's saved text and keep the selected swipe in sync.
 * @param {object} message Chat message object
 * @param {string} updatedText New message text
 * @returns {void}
 */
function setSavedMessageText(message, updatedText) {
    const previousText = message.mes;
    message.mes = updatedText;

    if (message.extra?.display_text === previousText) {
        message.extra.display_text = updatedText;
    }

    const swipeId = Number(message.swipe_id);
    if (Array.isArray(message.swipes) && Number.isInteger(swipeId) && swipeId >= 0 && swipeId < message.swipes.length) {
        message.swipes[swipeId] = updatedText;
    }
}

/**
 * Emit standard message update events for integrations that listen to edits.
 * @param {number} messageId Message id
 * @returns {Promise<void>}
 */
async function emitMessageUpdated(messageId) {
    if (event_types.MESSAGE_EDITED) {
        await eventSource.emit(event_types.MESSAGE_EDITED, messageId);
    }
    if (event_types.MESSAGE_UPDATED) {
        await eventSource.emit(event_types.MESSAGE_UPDATED, messageId);
    }
}

/**
 * Re-render a single message if it is currently displayed.
 * @param {number} messageId Message id
 * @param {object} message Chat message object
 * @returns {void}
 */
function rerenderMessage(messageId, message) {
    const context = SillyTavern.getContext();
    if (typeof context.updateMessageBlock === 'function' && chat.querySelector(`.mes[mesid="${messageId}"]`)) {
        context.updateMessageBlock(messageId, message);
    }
}

/**
 * Persist the current chat through SillyTavern's save path.
 * @returns {Promise<void>}
 */
async function saveCurrentChat() {
    const context = SillyTavern.getContext();
    if (typeof context.saveChat === 'function') {
        await context.saveChat();
    }
}

/**
 * Replace the currently selected search match and save the chat.
 * @returns {Promise<void>}
 */
async function replaceCurrentSearchMatch() {
    readSearchControls();
    rebuildSearchMatches(searchState.currentIndex);

    const match = searchState.matches[searchState.currentIndex];
    if (!match) {
        updateSearchStatus();
        return;
    }

    const context = SillyTavern.getContext();
    const message = context.chat?.[match.messageId];
    const text = getMessageSearchText(message);
    if (!message || !text) {
        return;
    }

    const updatedText = `${text.slice(0, match.start)}${searchState.replace}${text.slice(match.end)}`;
    setSavedMessageText(message, updatedText);
    rerenderMessage(match.messageId, message);
    await emitMessageUpdated(match.messageId);
    await saveCurrentChat();
    await refreshSearch({ preserveIndex: true, setDomFocus: true });
}

/**
 * Replace all matches in the current chat and save once.
 * @returns {Promise<void>}
 */
async function replaceAllSearchMatches() {
    readSearchControls();
    rebuildSearchMatches(0);

    if (!searchState.matches.length) {
        updateSearchStatus();
        return;
    }

    const messageIds = [...new Set(searchState.matches.map(match => match.messageId))];
    const confirmed = await Popup.show.confirm(
        t`Replace all matches?`,
        `${searchState.matches.length} matches in ${messageIds.length} messages will be replaced and saved to the current chat file.`,
    );
    if (!confirmed) {
        return;
    }

    const context = SillyTavern.getContext();
    const changedMessageIds = [];

    for (const messageId of messageIds) {
        const message = context.chat?.[messageId];
        const text = getMessageSearchText(message);
        const regex = buildSearchRegex();
        if (!message || !text || !regex) {
            continue;
        }

        const updatedText = text.replace(regex, () => searchState.replace);
        if (updatedText === text) {
            continue;
        }

        setSavedMessageText(message, updatedText);
        rerenderMessage(messageId, message);
        changedMessageIds.push(messageId);
    }

    for (const messageId of changedMessageIds) {
        await emitMessageUpdated(messageId);
    }

    if (changedMessageIds.length) {
        await saveCurrentChat();
    }

    await refreshSearch({ preserveIndex: false, setDomFocus: true });
}

/**
 * Bind mouse and keyboard activation to a search panel command button.
 * @param {HTMLElement} element Command element
 * @param {Function} handler Command handler
 * @returns {void}
 */
function bindSearchCommand(element, handler) {
    if (!element) {
        return;
    }

    const runHandler = () => Promise.resolve(handler()).catch(error => console.error(t`Search command failed`, error));

    element.tabIndex = 0;
    element.addEventListener('click', () => {
        if (element.getAttribute('aria-disabled') === 'true') {
            return;
        }
        runHandler();
    });
    element.addEventListener('keydown', event => {
        if (event.key !== 'Enter' && event.key !== ' ') {
            return;
        }
        event.preventDefault();
        if (element.getAttribute('aria-disabled') === 'true') {
            return;
        }
        runHandler();
    });
}

/**
 * Close the search panel and clear active highlights.
 * @returns {void}
 */
function closeSearchPanel() {
    readSearchControls();
    clearSearchHighlights();
    setReplaceModeVisible(false);
    searchPanel.classList.remove('visible');
    document.getElementById('extensionTopBarSearch')?.classList.remove('active');
}

/**
 * Toggle replace controls inside the compact search panel.
 * @param {boolean} visible Replace mode visibility
 * @returns {void}
 */
function setReplaceModeVisible(visible) {
    const controls = searchState.controls;
    controls.replaceMode?.classList.toggle('visible', visible);
    controls.replaceToggleButton?.setAttribute('aria-expanded', String(visible));
    controls.replaceToggleButton?.setAttribute('title', visible ? 'Hide replace' : 'Show replace');
    controls.replaceToggleIcon?.classList.toggle('fa-angle-right', !visible);
    controls.replaceToggleIcon?.classList.toggle('fa-angle-down', visible);
}

/**
 * Position the floating search panel below the top bar.
 * @returns {void}
 */
function positionSearchPanel() {
    const topBarRect = topBar.getBoundingClientRect();
    const right = Math.max(window.innerWidth - topBarRect.right + 10, 10);

    searchPanel.style.top = `${topBarRect.bottom + 6}px`;
    searchPanel.style.right = `${right}px`;
}

/**
 * Initialize the floating search panel.
 * @returns {void}
 */
function addSearchPanel() {
    searchPanel.id = 'extensionTopBarSearchPanel';
    searchPanel.innerHTML = `
        <div class="extensionTopBarSearchHeader">
            <strong>Search</strong>
            <div id="extensionTopBarSearchClose" class="menu_button menu_button_icon extensionTopBarSearchIconButton" title="Close search panel">
                <i class="fa-solid fa-times"></i>
            </div>
        </div>
        <div class="extensionTopBarSearchMain">
            <div id="extensionTopBarSearchReplaceToggle" class="menu_button menu_button_icon extensionTopBarSearchIconButton extensionTopBarSearchReplaceToggle" title="Show replace" aria-expanded="false">
                <i class="fa-solid fa-angle-right"></i>
            </div>
            <div class="extensionTopBarSearchLines">
                <div class="extensionTopBarSearchRow extensionTopBarSearchFindRow">
                    <input id="extensionTopBarSearchQuery" class="text_pole" type="search" autocomplete="off" placeholder="Search..." aria-label="Find">
                    <small id="extensionTopBarSearchStatus" class="extensionTopBarSearchStatus">0 / 0</small>
                    <div id="extensionTopBarSearchPrevious" class="menu_button menu_button_icon extensionTopBarSearchIconButton" title="Previous match">
                        <i class="fa-solid fa-chevron-up"></i>
                    </div>
                    <div id="extensionTopBarSearchNext" class="menu_button menu_button_icon extensionTopBarSearchIconButton" title="Next match">
                        <i class="fa-solid fa-chevron-down"></i>
                    </div>
                </div>
                <div id="extensionTopBarSearchReplaceMode" class="extensionTopBarSearchReplaceMode">
                    <div class="extensionTopBarSearchRow extensionTopBarSearchReplaceRow">
                        <input id="extensionTopBarSearchReplace" class="text_pole" type="text" autocomplete="off" placeholder="Replace with..." aria-label="Replace with">
                        <div id="extensionTopBarSearchReplaceCurrent" class="menu_button menu_button_icon extensionTopBarSearchIconButton" title="Replace current match">
                            <i class="fa-solid fa-right-left"></i>
                        </div>
                        <div id="extensionTopBarSearchReplaceAll" class="menu_button menu_button_icon extensionTopBarSearchIconButton extensionTopBarSearchDangerButton" title="Replace all matches">
                            <i class="fa-solid fa-arrows-rotate"></i>
                        </div>
                    </div>
                </div>
            </div>
        </div>
        <div class="extensionTopBarSearchOptions">
            <label class="checkbox_label" for="extensionTopBarSearchCaseSensitive">
                <input id="extensionTopBarSearchCaseSensitive" type="checkbox">
                <span>Case sensitive</span>
            </label>
            <label class="checkbox_label" for="extensionTopBarSearchWholeWord">
                <input id="extensionTopBarSearchWholeWord" type="checkbox">
                <span>Whole word</span>
            </label>
        </div>
    `;

    searchState.controls = {
        queryInput: searchPanel.querySelector('#extensionTopBarSearchQuery'),
        replaceInput: searchPanel.querySelector('#extensionTopBarSearchReplace'),
        caseSensitiveInput: searchPanel.querySelector('#extensionTopBarSearchCaseSensitive'),
        wholeWordInput: searchPanel.querySelector('#extensionTopBarSearchWholeWord'),
        replaceMode: searchPanel.querySelector('#extensionTopBarSearchReplaceMode'),
        replaceToggleButton: searchPanel.querySelector('#extensionTopBarSearchReplaceToggle'),
        replaceToggleIcon: searchPanel.querySelector('#extensionTopBarSearchReplaceToggle i'),
        closeButton: searchPanel.querySelector('#extensionTopBarSearchClose'),
        previousButton: searchPanel.querySelector('#extensionTopBarSearchPrevious'),
        nextButton: searchPanel.querySelector('#extensionTopBarSearchNext'),
        replaceCurrentButton: searchPanel.querySelector('#extensionTopBarSearchReplaceCurrent'),
        replaceAllButton: searchPanel.querySelector('#extensionTopBarSearchReplaceAll'),
        status: searchPanel.querySelector('#extensionTopBarSearchStatus'),
    };

    const {
        queryInput,
        replaceInput,
        caseSensitiveInput,
        wholeWordInput,
    } = searchState.controls;

    if (!(queryInput instanceof HTMLInputElement) ||
        !(replaceInput instanceof HTMLInputElement) ||
        !(caseSensitiveInput instanceof HTMLInputElement) ||
        !(wholeWordInput instanceof HTMLInputElement)) {
        console.warn(t`Search panel controls not found.`);
        return;
    }

    queryInput.addEventListener('input', searchRefreshDebounced);
    queryInput.addEventListener('keydown', event => {
        if (event.key === 'Escape') {
            event.preventDefault();
            closeSearchPanel();
            return;
        }

        if (event.key !== 'Enter') {
            return;
        }

        event.preventDefault();
        Promise.resolve(moveSearchMatch(event.shiftKey ? -1 : 1)).catch(error => console.error(t`Search command failed`, error));
    });
    replaceInput.addEventListener('input', readSearchControls);
    replaceInput.addEventListener('keydown', event => {
        if (event.key === 'Escape') {
            event.preventDefault();
            closeSearchPanel();
        }
    });
    caseSensitiveInput.addEventListener('change', () => refreshSearch({ preserveIndex: false }));
    wholeWordInput.addEventListener('change', () => refreshSearch({ preserveIndex: false }));
    bindSearchCommand(searchState.controls.replaceToggleButton, () => {
        const isVisible = searchState.controls.replaceMode?.classList.contains('visible');
        setReplaceModeVisible(!isVisible);
        if (!isVisible) {
            replaceInput.focus();
        }
    });
    bindSearchCommand(searchState.controls.closeButton, closeSearchPanel);
    bindSearchCommand(searchState.controls.previousButton, () => moveSearchMatch(-1));
    bindSearchCommand(searchState.controls.nextButton, () => moveSearchMatch(1));
    bindSearchCommand(searchState.controls.replaceCurrentButton, replaceCurrentSearchMatch);
    bindSearchCommand(searchState.controls.replaceAllButton, replaceAllSearchMatches);
    updateSearchStatus();

    document.body.appendChild(searchPanel);
    window.addEventListener('resize', () => {
        if (searchPanel.classList.contains('visible')) {
            positionSearchPanel();
        }
    });
}

/**
 * Open the floating search panel.
 * @returns {Promise<void>}
 */
async function onSearchClick() {
    if (searchPanel.classList.contains('visible')) {
        searchState.controls.queryInput?.focus();
        return;
    }

    document.getElementById('extensionTopBarSearch')?.classList.add('active');
    positionSearchPanel();
    searchPanel.classList.add('visible');
    searchState.controls.queryInput?.focus();
    await refreshSearch({ preserveIndex: true });
}

const updateStatusDebounced = debounce(onOnlineStatusChange, 1000);

function addTopBar() {
    chatName.id = 'extensionTopBarChatName';
    topBar.id = 'extensionTopBar';
    topBar.append(chatName);
    sheld.insertBefore(topBar, chat);
}

function addIcons() {
    icons.forEach(icon => {
        const iconElement = document.createElement('i');
        iconElement.id = icon.id;
        iconElement.className = icon.icon;
        iconElement.title = icon.title;
        iconElement.tabIndex = 0;
        iconElement.classList.add('right_menu_button');
        iconElement.addEventListener('click', () => {
            if (iconElement.classList.contains('not-in-chat')) {
                return;
            }
            Promise.resolve(icon.onClick()).catch(error => console.error(t`Top bar button failed`, error));
        });
        if (icon.position === 'left') {
            topBar.insertBefore(iconElement, chatName);
            return;
        }
        if (icon.position === 'right') {
            topBar.appendChild(iconElement);
            return;
        }
        if (icon.position === 'middle') {
            topBar.appendChild(iconElement);
            return;
        }
        if (icon.id === 'extensionTopBarRenameChat' && typeof renameChat !== 'function') {
            iconElement.classList.add('displayNone');
        }
    });
}

function addSideBar() {
    if (!draggableTemplate) {
        console.warn(t`Draggable template not found. Side bar will not be added.`);
        return;
    }

    const fragment = /** @type {DocumentFragment} */ (draggableTemplate.content.cloneNode(true));
    const draggable = fragment.querySelector('.draggable');
    const closeButton = fragment.querySelector('.dragClose');

    if (!draggable || !closeButton) {
        console.warn(t`Failed to find draggable or close button. Side bar will not be added.`);
        return;
    }

    draggable.id = 'extensionSideBar';
    closeButton.addEventListener('click', onToggleSidebarClick);

    const scrollContainer = document.createElement('div');
    scrollContainer.id = 'extensionSideBarContainer';
    draggable.appendChild(scrollContainer);

    const loaderContainer = document.createElement('div');
    loaderContainer.id = 'extensionSideBarLoader';
    draggable.appendChild(loaderContainer);

    const loaderIcon = document.createElement('i');
    loaderIcon.className = 'fa-2x fa-solid fa-gear fa-spin';
    loaderContainer.appendChild(loaderIcon);

    movingDivs.appendChild(draggable);
}

function addConnectionProfiles() {
    connectionProfiles.id = 'extensionConnectionProfiles';
    connectionProfilesStatus.id = 'extensionConnectionProfilesStatus';
    connectionProfilesSelect.id = 'extensionConnectionProfilesSelect';
    connectionProfilesSelect.title = t`Switch connection profile`;

    const connectionProfilesServerIcon = document.createElement('i');
    connectionProfilesServerIcon.id = 'extensionConnectionProfilesIcon';
    connectionProfilesServerIcon.className = 'fa-fw fa-solid fa-network-wired';

    connectionProfiles.append(connectionProfilesServerIcon, connectionProfilesSelect, connectionProfilesStatus, connectionProfilesIcon);
    sheld.insertBefore(connectionProfiles, chat);

    apiBlock.querySelectorAll('select').forEach(select => {
        select.addEventListener('input', () => updateStatusDebounced());
    });
}

function bindConnectionProfilesSelect() {
    waitUntilCondition(() => document.getElementById('connection_profiles') !== null).then(() => {
        const connectionProfilesMainSelect = /** @type {HTMLSelectElement} */ (document.getElementById('connection_profiles'));
        if (!connectionProfilesMainSelect) {
            return;
        }
        connectionProfilesSelect.addEventListener('change', async () => {
            connectionProfilesMainSelect.value = connectionProfilesSelect.value;
            connectionProfilesMainSelect.dispatchEvent(new Event('change'));
        });
        connectionProfilesMainSelect.addEventListener('change', async () => {
            connectionProfilesSelect.value = connectionProfilesMainSelect.value;
        });
        const observer = new MutationObserver(() => {
            connectionProfilesSelect.innerHTML = connectionProfilesMainSelect.innerHTML;
            connectionProfilesSelect.value = connectionProfilesMainSelect.value;
        });
        observer.observe(connectionProfilesMainSelect, { childList: true });
    });
}

async function onToggleSidebarClick() {
    const sidebar = document.getElementById('extensionSideBar');
    const toggle = document.getElementById('extensionTopBarToggleSidebar');

    if (!sidebar || !toggle) {
        console.warn(t`Sidebar or toggle button not found`);
        return;
    }

    toggle.classList.toggle('active');
    const alreadyVisible = sidebar.classList.contains('visible');

    const keyframes = [
        { opacity: alreadyVisible ? 1 : 0 },
        { opacity: alreadyVisible ? 0 : 1 },
    ];
    const options = {
        duration: animation_duration,
        easing: animation_easing,
    };

    const animation = sidebar.animate(keyframes, options);

    if (alreadyVisible) {
        await animation.finished;
        sidebar.classList.toggle('visible');
        await populateSideBar();
    } else {
        sidebar.classList.toggle('visible');
        await populateSideBar();
        await animation.finished;
    }

    savePanelsState();
}

async function populateSideBar() {
    const sidebar = document.getElementById('extensionSideBar');
    const loader = document.getElementById('extensionSideBarLoader');
    const container = document.getElementById('extensionSideBarContainer');

    if (!loader || !container || !sidebar) {
        return;
    }

    if (!sidebar.classList.contains('visible')) {
        container.innerHTML = '';
        return;
    }

    loader.classList.add('displayNone');
    const processId = uuidv4();
    const scrollTop = container.scrollTop;
    const prettify = x => {
        x.last_mes = timestampToMoment(x.last_mes);
        x.file_name = String(x.file_name).replace('.jsonl', '');
        return x;
    };
    container.dataset.processId = processId;
    const chatId = getCurrentChatId();
    const chats = (await getChatFiles()).map(prettify).sort((a, b) => sortMoments(a.last_mes, b.last_mes));

    if (container.dataset.processId !== processId) {
        console.log(t`Aborting populateSideBar due to process id mismatch`);
        return;
    }

    container.innerHTML = '';

    for (const chat of chats) {
        const sideBarItem = document.createElement('div');
        sideBarItem.classList.add('sideBarItem');

        sideBarItem.addEventListener('click', async () => {
            if (chat.file_name === chatId || sideBarItem.classList.contains('selected')) {
                return;
            }

            container.childNodes.forEach(x => x instanceof HTMLElement && x.classList.remove('selected'));
            sideBarItem.classList.add('selected');
            await openChatById(chat.file_name);
        });

        const isSelected = chat.file_name === chatId;
        sideBarItem.classList.toggle('selected', isSelected);

        const chatName = document.createElement('div');
        chatName.classList.add('chatName');
        chatName.textContent = chat.file_name;
        chatName.title = chat.file_name;

        const chatDate = document.createElement('small');
        chatDate.classList.add('chatDate');
        chatDate.textContent = chat.last_mes.format('l');
        chatDate.title = chat.last_mes.format('LL LT');

        const chatNameContainer = document.createElement('div');
        chatNameContainer.classList.add('chatNameContainer');
        chatNameContainer.append(chatName, chatDate);

        const chatMessage = document.createElement('div');
        chatMessage.classList.add('chatMessage');
        chatMessage.textContent = chat.mes;
        chatMessage.title = chat.mes;

        const chatStats = document.createElement('div');
        chatStats.classList.add('chatStats');

        const counterBlock = document.createElement('div');
        counterBlock.classList.add('counterBlock');

        const counterIcon = document.createElement('i');
        counterIcon.classList.add('fa-solid', 'fa-comment', 'fa-xs');

        const counterText = document.createElement('small');
        counterText.textContent = chat.chat_items;

        counterBlock.append(counterIcon, counterText);

        const fileSizeText = document.createElement('small');
        fileSizeText.classList.add('fileSize');
        fileSizeText.textContent = chat.file_size;

        chatStats.append(counterBlock, fileSizeText);

        const chatMessageContainer = document.createElement('div');
        chatMessageContainer.classList.add('chatMessageContainer');
        chatMessageContainer.append(chatMessage, chatStats);

        sideBarItem.append(chatNameContainer, chatMessageContainer);
        container.appendChild(sideBarItem);
    }

    container.scrollTop = scrollTop;

    /** @type {HTMLElement} */
    const selectedElement = container.querySelector('.selected');
    const isSelectedElementVisible = selectedElement && selectedElement.offsetTop >= container.scrollTop && selectedElement.offsetTop <= container.scrollTop + container.clientHeight;
    if (!isSelectedElementVisible) {
        container.scrollTop = selectedElement.offsetTop - container.clientHeight / 2;
    }

    loader.classList.add('displayNone');
}

async function openChatById(chatId) {
    const context = SillyTavern.getContext();

    if (!chatId) {
        return;
    }

    if (typeof openGroupChat === 'function' && context.groupId) {
        await openGroupChat(context.groupId, chatId);
        return;
    }

    if (typeof openCharacterChat === 'function' && context.characterId !== undefined) {
        await openCharacterChat(chatId);
        return;
    }
}

async function onChatNameChange() {
    const chatId = chatName.value;
    await openChatById(chatId);
}

async function onToggleConnectionProfilesClick() {
    const button = document.getElementById('extensionTopBarToggleConnectionProfiles');

    if (!button) {
        console.warn('Connection profiles button not found');
        return;
    }

    button.classList.toggle('active');
    connectionProfiles.classList.toggle('visible');
    savePanelsState();
    await onOnlineStatusChange();
}

async function onOnlineStatusChange() {
    if (!connectionProfiles.classList.contains('visible')) {
        return;
    }

    const connectionProfilesMainSelect = /** @type {HTMLSelectElement} */ (document.getElementById('connection_profiles'));
    if (connectionProfilesMainSelect) {
        connectionProfilesSelect.innerHTML = connectionProfilesMainSelect.innerHTML;
        connectionProfilesSelect.value = connectionProfilesMainSelect.value;
    } else {
        connectionProfilesSelect.classList.add('displayNone');
    }

    if (connectionProfilesStatus.nextElementSibling?.classList?.contains('icon-svg')) {
        connectionProfilesStatus.nextElementSibling.remove();
    }

    const { SlashCommandParser, onlineStatus, mainApi } = SillyTavern.getContext();

    if (onlineStatus === 'no_connection') {
        connectionProfilesStatus.classList.add('offline');
        connectionProfilesStatus.textContent = t`No connection...`;

        const nullIcon = new Image();
        nullIcon.classList.add('icon-svg', 'null-icon');
        connectionProfilesStatus.insertAdjacentElement('afterend', nullIcon);
        return;
    }

    async function getCurrentAPI() {
        let currentAPI = mainApi;
        try {
            const commandResult = await SlashCommandParser.commands['api'].callback({ quiet: 'true' }, '');
            if (commandResult) {
                currentAPI = commandResult;
            }
        } catch (error) {
            console.error(t`Failed to get current API`, error);
        }
        const fancyNameOption = apiBlock.querySelector(`select:not(#main_api) option[value="${currentAPI}"]`) ?? apiBlock.querySelector(`select#main_api option[value="${currentAPI}"]`);
        if (fancyNameOption) {
            // Remove text in parentheses or brackets
            return fancyNameOption.textContent.replace(/[[(].*[\])]/, '').trim();
        }
        return currentAPI;
    }

    async function getCurrentModel() {
        let currentModel = onlineStatus;
        try {
            const commandResult = await SlashCommandParser.commands['model'].callback({ quiet: 'true' }, '');
            if (commandResult && typeof commandResult === 'string') {
                currentModel = commandResult;
            }
        } catch (error) {
            console.error(t`Failed to get current model`, error);
        }
        const fancyNameOption = apiBlock.querySelector(`option[value="${currentModel}"]`);
        if (fancyNameOption) {
            return fancyNameOption.textContent.trim();
        }
        return currentModel;
    }

    const [currentAPI, currentModel] = await Promise.all([getCurrentAPI(), getCurrentModel()]);
    await addConnectionProfileIcon();
    connectionProfilesStatus.classList.remove('offline');
    connectionProfilesStatus.textContent = `${currentAPI} – ${currentModel}`;
}

async function addConnectionProfileIcon() {
    return new Promise((resolve) => {
        const modelName = getGeneratingApi();
        const image = new Image();
        image.classList.add('icon-svg');
        image.src = `/img/${modelName}.svg`;

        image.onload = async function () {
            connectionProfilesStatus.insertAdjacentElement('afterend', image);
            await SVGInject(image);
            resolve();
        };

        image.onerror = function () {
            resolve();
        };

        // Prevent infinite waiting
        setTimeout(() => resolve(), 500);
    });
}

function savePanelsState() {
    localStorage.setItem('topBarPanelsState', JSON.stringify({
        sidebarVisible: document.getElementById('extensionSideBar')?.classList.contains('visible'),
        connectionProfilesVisible: document.getElementById('extensionConnectionProfiles')?.classList.contains('visible'),
    }));
}

function restorePanelsState() {
    const state = JSON.parse(localStorage.getItem('topBarPanelsState'));

    if (!state) {
        return;
    }

    if (state.sidebarVisible) {
        document.getElementById('extensionTopBarToggleSidebar')?.click();
    }

    if (state.connectionProfilesVisible) {
        document.getElementById('extensionTopBarToggleConnectionProfiles')?.click();
    }
}

// Init extension on load
(async function () {
    addJQueryHighlight();
    patchSheldIfNeeded();
    addTopBar();
    addSearchPanel();
    addIcons();
    addSideBar();
    addConnectionProfiles();
    setChatName(getCurrentChatId());
    chatName.addEventListener('change', onChatNameChange);
    const setChatNameDebounced = debounce(() => setChatName(getCurrentChatId()), debounce_timeout.short);
    for (const eventName of [event_types.CHAT_CHANGED, event_types.CHAT_DELETED, event_types.GROUP_CHAT_DELETED]) {
        eventSource.on(eventName, setChatNameDebounced);
    }
    eventSource.once(event_types.APP_READY, () => {
        bindConnectionProfilesSelect();
        restorePanelsState();
    });
    eventSource.on(event_types.ONLINE_STATUS_CHANGED, updateStatusDebounced);
})();
