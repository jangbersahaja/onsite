/* eslint-disable @next/next/no-img-element */
type OutletAvatarProps = {
  name: string;
  imageUrl?: string | null;
  fallback?: string;
  className?: string;
};

export function OutletAvatar({
  name,
  imageUrl,
  fallback,
  className = "outlet-avatar",
}: OutletAvatarProps) {
  if (imageUrl) {
    return (
      <span className={className} aria-hidden="true">
        <img src={imageUrl} alt="" draggable={false} />
      </span>
    );
  }
  return (
    <span className={className} aria-hidden="true">
      {fallback ?? name.charAt(0).toUpperCase()}
    </span>
  );
}
