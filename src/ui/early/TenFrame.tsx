/** A ten-frame: two rows of five. Dots are circles for the first number, squares for the second, so colour never carries meaning alone. */
export function TenFrame({ n, shape, label }: { n: number; shape: 'circle' | 'square'; label: string }) {
  const frames = Math.max(1, Math.ceil(n / 10));
  return (
    <div className="tenframes" role="img" aria-label={label}>
      {Array.from({ length: frames }, (_, f) => (
        <div className="tenframe" key={f}>
          {Array.from({ length: 10 }, (_, i) => {
            const filled = f * 10 + i < n;
            return <span key={i} className={`tf-cell ${filled ? `is-on is-${shape}` : ''}`} />;
          })}
        </div>
      ))}
    </div>
  );
}
