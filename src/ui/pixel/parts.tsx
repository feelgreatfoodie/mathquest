import type { ButtonHTMLAttributes, ElementType, HTMLAttributes, ReactNode } from 'react';

/**
 * The shared pixel-frame parts. Every kid-screen panel, key and button is a frame: no radius, stepped corners and a two-tone
 * bevel from box-shadow (see .px-frame in styles.css). Later features (lairs, Lightning, trophy room) reuse these.
 * tone picks the fill: neutral, gold, go, stone, or an area (dungeon, adventure, lightning).
 */
export type PixelTone = 'neutral' | 'gold' | 'go' | 'stone' | 'dungeon' | 'adventure' | 'lightning';

export function PixelFrame<T extends ElementType = 'div'>({
  as,
  tone = 'neutral',
  className,
  children,
  ...rest
}: { as?: T; tone?: PixelTone; className?: string; children?: ReactNode } & Omit<HTMLAttributes<HTMLElement>, 'className' | 'children'>) {
  const Tag = (as ?? 'div') as ElementType;
  return (
    <Tag className={`px-frame px-${tone}${className ? ` ${className}` : ''}`} {...rest}>
      {children}
    </Tag>
  );
}

/** size: normal is at least 48 px tall, big 72 px, prereader 120 px. */
export function PixelButton({
  tone = 'neutral',
  size = 'normal',
  className,
  children,
  type = 'button',
  ...rest
}: { tone?: PixelTone; size?: 'normal' | 'big' | 'prereader'; className?: string; children?: ReactNode } & Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'className' | 'children'>) {
  return (
    <button type={type} className={`px-frame px-btn px-${tone} px-${size}${className ? ` ${className}` : ''}`} {...rest}>
      {children}
    </button>
  );
}
