window.CopyAdgRuleToClipboard = function(text) {
    navigator.clipboard.writeText(text).catch(err => {
        console.error('复制失败:', err);
    });
};