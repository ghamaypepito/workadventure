/** Never fan a personal signal out to ambiguous or anonymous identities. */
export function selectSocialSignalTargets<T extends { id: number; uuid: string }>(
    candidates: Iterable<T>,
    receiverUserUuid: string,
    receiverUserId?: number,
): T[] {
    const matches = [...candidates].filter((user) => user.uuid === receiverUserUuid);
    if (receiverUserId !== undefined) return matches.filter((user) => user.id === receiverUserId);
    return receiverUserUuid && matches.length === 1 ? matches : [];
}
