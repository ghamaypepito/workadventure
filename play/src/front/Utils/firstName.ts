/** Short label for the office UI; account names and identifiers stay unchanged. */
export function firstName(name: string): string {
    return name.trim().split(/\s+/)[0] ?? "";
}
