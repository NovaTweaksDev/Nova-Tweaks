import { joinClasses } from './classNames';

function PageShell({ children, className = '' }) {
  return (
    <section className={joinClasses('animate-enter ui-page-shell', className)}>
      {children}
    </section>
  );
}

function PageHeadingSignal() {
  return null;
}

function PageHeader({
  title,
  description,
  actions = null,
  status = null,
  className = ''
}) {
  return (
    <header className={joinClasses('ui-page-header', className)}>
      <div className="ui-page-heading min-w-0">
        <PageHeadingSignal />
        <div className="min-w-0">
          <h1 className="ui-page-title">{title}</h1>
          {description ? <p className="ui-page-description">{description}</p> : null}
        </div>
      </div>

      {(status || actions) ? (
        <div className="ui-page-header-side">
          {status}
          {actions}
        </div>
      ) : null}
    </header>
  );
}

function PageSection({
  as: Component = 'section',
  children,
  className = '',
  surface = 'default',
  elevation = 'base',
  density = 'normal',
  interactive = false
}) {
  return (
    <Component
      data-surface={surface}
      data-elevation={elevation}
      data-density={density}
      className={joinClasses('ui-card', interactive ? 'ui-card-interactive' : '', className)}
    >
      {children}
    </Component>
  );
}

function SectionHeader({ title, description, actions = null, className = '' }) {
  return (
    <div className={joinClasses('ui-section-header', className)}>
      <div className="min-w-0">
        <h2 className="ui-section-title">{title}</h2>
        {description ? <p className="ui-section-description">{description}</p> : null}
      </div>
      {actions ? <div className="ui-section-actions">{actions}</div> : null}
    </div>
  );
}

function StatusPill({ children, tone = 'neutral', className = '' }) {
  return (
    <span className={joinClasses('ui-status-pill', `ui-status-pill-${tone}`, className)}>
      {children}
    </span>
  );
}

function Badge({ children, tone = 'neutral', className = '' }) {
  return <span className={joinClasses('ui-badge', `ui-badge-${tone}`, className)}>{children}</span>;
}

function IconContainer({ children, tone = 'neutral', className = '', style = undefined }) {
  return (
    <span
      className={joinClasses('ui-icon-container', `ui-icon-container-${tone}`, className)}
      style={style}
    >
      {children}
    </span>
  );
}

function IconBadge({ children, tone = 'neutral', className = '' }) {
  return <IconContainer tone={tone} className={joinClasses('ui-icon-badge', className)}>{children}</IconContainer>;
}

export { Badge, IconBadge, IconContainer, PageHeader, PageHeadingSignal, PageSection, PageShell, SectionHeader, StatusPill };
