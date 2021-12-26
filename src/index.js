class Chat {
    constructor(element, options = {}) {
        this.bootstrap(element);
        this.limit = options.limit ?? 30;
        this.speed = options.speed ?? 0.2;
        this.connect(options.channels || [], options.apiKey);
    }

    bootstrap (element) {
        const wrapper = document.createElement('div');
        wrapper.style.position = 'relative';
        wrapper.style.overflow = 'hidden';
        wrapper.style.height = '100%';
        wrapper.style.width = '100%';

        const chat = document.createElement('div');
        chat.style.position = 'absolute';
        chat.style.bottom = '0';
        chat.style.width = '100%';

        wrapper.appendChild(chat);
        element.appendChild(wrapper);
        this.element = chat;
    }

    async connect(channels, apiKey) {
        // Convert channel usernames to ids
        const channelIds = await Promise.all(channels.map(channel => {
            const url = new URL('https://www.googleapis.com/youtube/v3/channels');
            url.searchParams.set('forUsername', channel);
            url.searchParams.set('key', apiKey);
            return fetch(url.toString())
                .then(res => res.json())
                .then(res => res.items && res.items.length
                    ? ({ channel, channelId: res.items[0].id })
                    : ({ channel, error: true }))
                .catch(() => ({ channel, error: true }));
        }));

        // Log any bad channels
        channelIds.filter(data => data.error).forEach(data => {
            console.error(`Unable to fetch channel Id for ${data.channel}`);
        });

        // Fetch live streams for each channel
        const streams = await Promise.all(channelIds.filter(data => !data.error).map(data => {
            const url = new URL('https://www.googleapis.com/youtube/v3/search');
            url.searchParams.set('part', 'id');
            url.searchParams.set('eventType', 'live');
            url.searchParams.set('type', 'video');
            url.searchParams.set('channelId', data.channelId);
            url.searchParams.set('key', apiKey);
            return fetch(url.toString())
                .then(res => res.json())
                .then(res => res.items && res.items.length
                    ? ({ ...data, streamId: res.items[0].id.videoId })
                    : ({ ...data, error: true }))
                .catch(() => ({ ...data, error: true }));
        }));

        // Log any bad channels
        streams.filter(data => data.error).forEach(data => {
            console.error(`Unable to fetch live stream Id for ${data.channel} (${data.channelId})`);
        });

        // Fetch live chats for each stream
        const chats = await Promise.all(streams.filter(data => !data.error).map(data => {
            const url = new URL('https://www.googleapis.com/youtube/v3/videos');
            url.searchParams.set('part', 'liveStreamingDetails');
            url.searchParams.set('id', data.streamId);
            url.searchParams.set('key', apiKey);
            return fetch(url.toString())
                .then(res => res.json())
                .then(res => res.items && res.items.length
                    ? ({ ...data, chatId: res.items[0].liveStreamingDetails.activeLiveChatId })
                    : ({ ...data, error: true }))
                .catch(() => ({ ...data, error: true }));
        }));

        // Log any bad channels
        chats.filter(data => data.error).forEach(data => {
            console.error(`Unable to fetch live chat Id for ${data.channel} (${data.channelId}, ${data.streamId})`);
        });

        // Start running each chat
        chats.filter(data => !data.error).forEach(data => this.fetch(data, apiKey));
    }

    async fetch(channelData, apiKey, lastSeen = null, lastFetch = null) {
        // Track fetch start
        const now = new Date();

        // Fetch the messages
        const url = new URL('https://www.googleapis.com/youtube/v3/liveChat/messages');
        url.searchParams.set('part', 'id,snippet,authorDetails');
        url.searchParams.set('maxResults', '2000');
        url.searchParams.set('liveChatId', channelData.chatId);
        url.searchParams.set('key', apiKey);
        const msgData = await fetch(url.toString())
            .then(res => res.json())
            .catch(() => null);

        // Convert dates and sort
        msgData.items.forEach(item => {
            item.snippet.publishedAt = new Date(item.snippet.publishedAt);
        });
        msgData.items.sort((a, b) => a.snippet.publishedAt - b.snippet.publishedAt);

        // Process each message, tracking newest message seen
        let lastSeenNew = lastSeen;
        for (const message of msgData.items) {
            // Skip if message is older than last seen
            if (lastSeen && message.snippet.publishedAt <= lastSeen) continue;

            // Update last seen if newer
            if (!lastSeenNew || message.snippet.publishedAt > lastSeenNew) lastSeenNew = message.snippet.publishedAt;

            // Emit message after delay
            setTimeout(() => this.message(channelData.channel, message),
                lastFetch ? message.snippet.publishedAt - lastFetch : 0);
        }

        // TODO: What is nextPageToken? Is it for getting newer messages, or older?

        setTimeout(() => this.fetch(channelData, apiKey, lastSeenNew, now), msgData.pollingIntervalMillis || 5000);
    }

    async message(channel, message) {
        // Get badges
        // TODO: Membership badges
        const badges = [
            message.authorDetails.isChatModerator && {
                name: 'Moderator',
                url: `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" preserveAspectRatio="xMidYMid meet" fill="rgb(94, 132, 241)" stroke="none"><g><path d="M9.64589146,7.05569719 C9.83346524,6.562372 9.93617022,6.02722257 9.93617022,5.46808511 C9.93617022,3.00042984 7.93574038,1 5.46808511,1 C4.90894765,1 4.37379823,1.10270499 3.88047304,1.29027875 L6.95744681,4.36725249 L4.36725255,6.95744681 L1.29027875,3.88047305 C1.10270498,4.37379824 1,4.90894766 1,5.46808511 C1,7.93574038 3.00042984,9.93617022 5.46808511,9.93617022 C6.02722256,9.93617022 6.56237198,9.83346524 7.05569716,9.64589147 L12.4098057,15 L15,12.4098057 L9.64589146,7.05569719 Z"></path></g></svg>')}`,
            },
        ].filter(x => !!x);

        // Get message + emotes
        // TODO: Emotes (YouTube + BTTV)
        const emotes = [
            {
                type: 'text',
                content: message.snippet.displayMessage,
            },
        ];

        // Create the badges element
        const badgesElm = document.createElement('span');
        for (const badge of badges) {
            const badgeElm = document.createElement('img');
            badgeElm.src = badge.url;
            badgeElm.alt = badge.name;
            badgeElm.title = badge.name;
            badgeElm.style.margin = '0 .3em .2em 0';
            badgeElm.style.verticalAlign = 'middle';
            badgeElm.style.width = '1.25em';
            badgeElm.style.height = '1.25em';
            badgeElm.style.borderRadius = '.2em';
            badgesElm.appendChild(badgeElm);
        }

        // Create the name
        const nameElm = document.createElement('span');
        nameElm.textContent = message.authorDetails.displayName;
        nameElm.style.wordBreak = 'break-all';
        nameElm.style.overflowWrap = 'anywhere';
        nameElm.style.fontWeight = '700';
        nameElm.style.margin = '0 .3em .2em 0';

        // Create the message element
        const messageElm = document.createElement('span');
        messageElm.style.wordWrap = 'break-word';
        for (const part of emotes) {
            if (part.type === 'text') {
                const partElm = document.createElement('span');
                partElm.textContent = part.content;
                partElm.style.wordWrap = 'break-word';
                messageElm.appendChild(partElm);
                continue;
            }

            if (part.type === 'emote') {
                const partElm = document.createElement('span');
                const partImg = document.createElement('img');
                partImg.src = part.content.url;
                partImg.alt = part.content.name;
                partImg.title = part.content.name;
                partImg.style.verticalAlign = 'middle';
                partImg.style.width = '2em';
                partImg.style.height = '2em';
                partImg.style.margin = '-.25em 0';
                partElm.appendChild(partImg);
                messageElm.appendChild(partElm);
                continue;
            }

            console.error(`Unknown message part type: ${part.type}`);
        }

        // Create the wrapper
        const wrapperElm = document.createElement('div');
        wrapperElm.style.background = 'rgba(0, 0, 0, 0.5)';
        wrapperElm.style.color = '#fff';
        wrapperElm.style.borderRadius = '.2em';
        wrapperElm.style.padding = '.5em';
        wrapperElm.style.width = '100%';
        wrapperElm.style.boxSizing = 'border-box';
        wrapperElm.style.lineHeight = '1.2em';
        wrapperElm.style.overflowWrap = 'anywhere';
        wrapperElm.style.textOverflow = 'ellipsis';
        wrapperElm.style.overflow = 'hidden';
        wrapperElm.style.marginTop = '0';
        wrapperElm.style.opacity = '0';
        wrapperElm.style.transition = `opacity ${this.speed / 4}s, max-height ${this.speed}s, margin-top ${this.speed}s`;
        wrapperElm.appendChild(badgesElm);
        wrapperElm.appendChild(nameElm);
        wrapperElm.appendChild(messageElm);
        this.element.appendChild(wrapperElm);

        // Animate in the message
        window.requestAnimationFrame(() => {
            const { height } = wrapperElm.getBoundingClientRect();
            wrapperElm.style.maxHeight = '0';

            window.requestAnimationFrame(() => {
                window.requestAnimationFrame(() => {
                    wrapperElm.style.opacity = '1';
                    wrapperElm.style.maxHeight = `${height}px`;
                    wrapperElm.style.marginTop = '.5em';
                });
            });
        });

        // Enforce limit
        if (this.element.childElementCount > this.limit) this.element.removeChild(this.element.firstElementChild);
    }
}

module.exports = Chat;
