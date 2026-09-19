/// <reference types="vite/client" />


// Legacy custom-element viewer remains available to downstream callers.
// The main application uses Three.js/Spark.
declare namespace JSX {
  interface IntrinsicElements {
    'model-viewer': React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement> & {
      src: string; alt: string; 'camera-controls'?: boolean; 'auto-rotate'?: boolean; 'shadow-intensity'?: string;
    };
  }
}
