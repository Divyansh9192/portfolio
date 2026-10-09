/**
 * Runs before paint to set data-theme / data-motion / data-keys on <html> from saved preferences,
 * so there is no flash of the wrong theme. Rendered inside <head> by the root layout.
 */
const script = `(function(){try{var d=document.documentElement;var t=localStorage.getItem('theme');if(t!=='light'&&t!=='dark'){t=window.matchMedia('(prefers-color-scheme: light)').matches?'light':'dark';}d.dataset.theme=t;var m=localStorage.getItem('motion');if(m==='reduce'||m==='full'){d.dataset.motion=m;}if(localStorage.getItem('keys')==='off'){d.dataset.keys='off';}}catch(e){}})();`;

export function ThemeScript() {
  return <script dangerouslySetInnerHTML={{ __html: script }} />;
}
