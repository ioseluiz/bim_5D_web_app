const Footer = () => {
  const year = new Date().getFullYear();

  return (
    <footer style={{ backgroundColor: '#154b75' }} className="mt-auto py-3 text-center">
      <small style={{ color: 'rgba(255,255,255,0.85)', fontSize: 11, lineHeight: 1.7, display: 'block' }}>
        © {year} · Todos los derechos reservados
      </small>
      <small style={{ color: 'rgba(255,255,255,0.65)', fontSize: 10, display: 'block' }}>
        INIO Secret Devs
      </small>
    </footer>
  );
};

export default Footer;
