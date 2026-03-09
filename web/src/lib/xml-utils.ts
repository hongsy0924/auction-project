/**
 * Shared XML parsing utilities for EUC-KR encoded government API responses.
 * Used by both LURIS and EUM API clients.
 */

export function getXmlTag(xml: string, tag: string): string {
    const re = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`);
    const m = xml.match(re);
    return m ? m[1].trim() : "";
}

export function getXmlTagAll(xml: string, tag: string): string[] {
    const re = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, "g");
    const results: string[] = [];
    let m;
    while ((m = re.exec(xml)) !== null) {
        results.push(m[1].trim());
    }
    return results;
}
