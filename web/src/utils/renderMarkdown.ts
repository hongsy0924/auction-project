/** Lightweight markdown → HTML converter.
 * Handles: headings, bold, italic, lists, hr, blockquotes, line breaks, inline code. */
export function renderMarkdown(md: string): string {
    const lines = md.split("\n");
    const html: string[] = [];
    let inList: "ul" | "ol" | null = null;

    const closeList = () => {
        if (inList) {
            html.push(inList === "ul" ? "</ul>" : "</ol>");
            inList = null;
        }
    };

    for (const line of lines) {
        if (/^(-{3,}|_{3,}|\*{3,})$/.test(line.trim())) { closeList(); html.push("<hr />"); continue; }
        const hm = line.match(/^(#{1,4})\s+(.+)$/);
        if (hm) { closeList(); html.push(`<h${hm[1].length}>${inlineFmt(hm[2])}</h${hm[1].length}>`); continue; }
        const ulm = line.match(/^(\s*)[-*•]\s+(.+)$/);
        if (ulm) { if (inList !== "ul") { closeList(); html.push("<ul>"); inList = "ul"; } html.push(`<li>${inlineFmt(ulm[2])}</li>`); continue; }
        const olm = line.match(/^(\s*)\d+\.\s+(.+)$/);
        if (olm) { if (inList !== "ol") { closeList(); html.push("<ol>"); inList = "ol"; } html.push(`<li>${inlineFmt(olm[2])}</li>`); continue; }
        if (line.startsWith("> ")) { closeList(); html.push(`<blockquote>${inlineFmt(line.slice(2))}</blockquote>`); continue; }
        if (line.trim() === "") { closeList(); html.push("<br />"); continue; }
        closeList(); html.push(`<p>${inlineFmt(line)}</p>`);
    }
    closeList();
    return html.join("\n");
}

function inlineFmt(t: string): string {
    return t
        .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
        .replace(/__(.+?)__/g, "<strong>$1</strong>")
        .replace(/\*(.+?)\*/g, "<em>$1</em>")
        .replace(/_(.+?)_/g, "<em>$1</em>")
        .replace(/`([^`]+)`/g, "<code>$1</code>");
}
