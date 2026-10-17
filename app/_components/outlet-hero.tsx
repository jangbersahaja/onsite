/* eslint-disable @next/next/no-img-element */
type OutletHeroProps = {
  name: string;
  imageUrl?: string | null;
};

export function OutletHero({ name, imageUrl }: OutletHeroProps) {
  if (!imageUrl) return null;
  return (
    <div className="outlet-hero">
      <img src={imageUrl} alt={name} draggable={false} />
    </div>
  );
}
