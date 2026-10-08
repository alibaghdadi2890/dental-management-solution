import {
  archiveFilesSchema,
  discardUploadsQuerySchema,
  fileDownloadSchema,
  idSchema,
  patientFilesQuerySchema,
  patientFilesSchema,
  restoreFilesSchema,
  saveFilesSchema,
  updateFilesSchema,
  uploadIntentSchema,
  uploadTargetSchema,
} from '@dcm/contracts';
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { createZodDto, ZodResponse } from 'nestjs-zod';
import { z } from 'zod';
import { RequirePermission } from '../../../platform/http/route-access';
import { FilesService } from '../application/files.service';

class UploadIntentDto extends createZodDto(uploadIntentSchema) {}
class UploadTargetDto extends createZodDto(uploadTargetSchema) {}
class DiscardUploadsQueryDto extends createZodDto(discardUploadsQuerySchema) {}
class SaveFilesDto extends createZodDto(saveFilesSchema) {}
class PatientFilesQueryDto extends createZodDto(patientFilesQuerySchema) {}
class PatientFilesDto extends createZodDto(patientFilesSchema) {}
class UpdateFilesDto extends createZodDto(updateFilesSchema) {}
class ArchiveFilesDto extends createZodDto(archiveFilesSchema) {}
class RestoreFilesDto extends createZodDto(restoreFilesSchema) {}
class FileDownloadDto extends createZodDto(fileDownloadSchema) {}
class FileParamsDto extends createZodDto(z.object({ id: idSchema })) {}

/**
 * Patient files (feature 8; docs/modules/files.md). The bytes go from the browser to object
 * storage and back through signed URLs; these routes carry only the metadata. The services
 * re-check every permission, and decide per file who may archive it (F13).
 */
@Controller('files')
export class FilesController {
  constructor(private readonly files: FilesService) {}

  /** Where to upload one file: a pending row and its signed `PUT` URLs. */
  @Post('uploads')
  @RequirePermission('file:write')
  @ZodResponse({ status: 201, type: UploadTargetDto })
  requestUpload(@Body() body: UploadIntentDto) {
    return this.files.requestUpload(body);
  }

  /** Throws away the caller's uploads that were never saved. */
  @Delete('uploads')
  @RequirePermission('file:write')
  @HttpCode(HttpStatus.NO_CONTENT)
  async discardUploads(@Query() query: DiscardUploadsQueryDto): Promise<void> {
    await this.files.discardUploads(query.ids);
  }

  /** The Save of an upload batch. */
  @Post()
  @RequirePermission('file:write')
  @ZodResponse({ status: 201, type: PatientFilesDto })
  save(@Body() body: SaveFilesDto) {
    return this.files.save(body);
  }

  /** Every file of a patient, archived ones included, with signed URLs. */
  @Get()
  @RequirePermission('file:read')
  @ZodResponse({ type: PatientFilesDto })
  list(@Query() query: PatientFilesQueryDto) {
    return this.files.list(query.patientId);
  }

  /** Edits one file (the viewer) or several (the bulk bar). */
  @Patch()
  @RequirePermission('file:write')
  @ZodResponse({ type: PatientFilesDto })
  update(@Body() body: UpdateFilesDto) {
    return this.files.update(body);
  }

  @Post('archive')
  @RequirePermission('file:write')
  @ZodResponse({ status: 200, type: PatientFilesDto })
  archive(@Body() body: ArchiveFilesDto) {
    return this.files.archive(body);
  }

  @Post('restore')
  @RequirePermission('file:write')
  @ZodResponse({ status: 200, type: PatientFilesDto })
  restore(@Body() body: RestoreFilesDto) {
    return this.files.restore(body);
  }

  /** A short-lived URL for the original, saved under its original filename. */
  @Get(':id/download')
  @RequirePermission('file:read')
  @ZodResponse({ type: FileDownloadDto })
  download(@Param() params: FileParamsDto) {
    return this.files.download(params.id);
  }
}
