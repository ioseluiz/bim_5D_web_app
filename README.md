# Sistema de Estimación de Costos BIM 5D

Este proyecto es una plataforma para relacionar elementos de modelos BIM (IFC) con bases de datos de costos siguiendo el estándar MasterFormat.

## Funcionalidades principales:
- **Gestión de Costos**: Base de datos de actividades con costos unitarios (Material, Mano de Obra, Equipo) y organización por divisiones MasterFormat.
- **Kits de Actividades**: Agrupación de múltiples actividades para asignar a tipos de elementos BIM.
- **Gestión de Proyectos**: Organización de modelos BIM por proyectos.
- **Visor BIM**: Integración con [That Open Company](https://thatopen.com/) para visualizar modelos IFC directamente en el navegador.

## Instalación:
1. Crear entorno virtual: `python -m venv venv`
2. Activar: `.\venv\Scripts\activate`
3. Instalar dependencias: `pip install -r requirements.txt`
4. Ejecutar migraciones: `python manage.py migrate`
5. Crear superusuario: `python manage.py createsuperuser`
6. Iniciar servidor: `python manage.py runserver`

## Uso:
- Accede al panel de administración en `/admin/` para cargar actividades MasterFormat y crear kits.
- Crea un Proyecto y carga archivos IFC.
- Abre el visor de cada modelo para inspeccionar los elementos.
