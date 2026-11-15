/** Picture shown for a student who has no photo: a boy for a boy, a girl for a girl. */
export const avatarOf = (gender: string | null | undefined) => (gender === 'female' ? '/avatars/girl.svg' : '/avatars/boy.svg');
