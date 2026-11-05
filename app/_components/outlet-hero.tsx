/* eslint-disable @next/next/no-img-element */
type OutletHeroProps = {
  name: string;
  imageUrl?: string | null;
  muted?: boolean;
};

export function OutletHero({ name, imageUrl, muted = false }: OutletHeroProps) {
  if (!imageUrl) return null;
  return (
    <div className={muted ? "outlet-hero is-muted" : "outlet-hero"}>
      <img src={imageUrl} alt={name} draggable={false} />
    </div>
  );
}
