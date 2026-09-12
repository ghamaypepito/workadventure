// Public office URLs can change without moving the editable map or its assets.
export const OFFICE_ROOM_PATH = "/~/virtual-workplace/map.wam";
export const LEGACY_OFFICE_ROOM_PATH = "/~/vings-test/map.wam";

export function officeMapStoragePath(roomPath: string): string {
    return roomPath === OFFICE_ROOM_PATH ? "vings-test/map.wam" : roomPath.replace(/^\/~\//, "");
}
