// Public API of the files module. Other modules import from this file only (CLAUDE.md §4).
export { FilesModule } from './files.module';
export { FilesService } from './application/files.service';
export {
  FILE_ARCHIVED,
  FILE_RESTORED,
  FILE_UPDATED,
  FILE_UPLOADED,
  type FileArchived,
  type FileRestored,
  type FileUpdated,
  type FileUploaded,
} from './events/file-events';
