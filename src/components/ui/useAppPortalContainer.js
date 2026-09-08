import { useLayoutEffect, useState } from 'react';

export function useAppPortalContainer() {
  const [portalContainer, setPortalContainer] = useState(null);

  useLayoutEffect(() => {
    setPortalContainer(document.querySelector('.app-shell'));
  }, []);

  return portalContainer;
}
