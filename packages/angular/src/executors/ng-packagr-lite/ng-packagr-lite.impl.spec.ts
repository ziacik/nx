jest.mock('@nx/devkit');
jest.mock('@nx/js/src/utils/buildable-libs-utils');
jest.mock('ng-packagr');
jest.mock('ng-packagr/lib/utils/ng-compiler-cli');
jest.mock('./ng-packagr-adjustments/ng-package/options.di');

import type { ExecutorContext } from '@nx/devkit';
import * as buildableLibsUtils from '@nx/js/src/utils/buildable-libs-utils';
import * as ngPackagr from 'ng-packagr';
import { ngCompilerCli } from 'ng-packagr/lib/utils/ng-compiler-cli';
import { BehaviorSubject } from 'rxjs';
import type { BuildAngularLibraryExecutorOptions } from '../package/schema';
import { NX_ENTRY_POINT_PROVIDERS } from './ng-packagr-adjustments/ng-package/entry-point/entry-point.di';
import { nxProvideOptions } from './ng-packagr-adjustments/ng-package/options.di';
import {
  NX_PACKAGE_PROVIDERS,
  NX_PACKAGE_TRANSFORM,
} from './ng-packagr-adjustments/ng-package/package.di';
import { ngPackagrLiteExecutor } from './ng-packagr-lite.impl';

describe('NgPackagrLite executor', () => {
  let context: ExecutorContext;
  let ngPackagrBuildMock: jest.Mock;
  let ngPackagerWatchSubject: BehaviorSubject<void>;
  let ngPackagrWatchMock: jest.Mock;
  let ngPackagrWithBuildTransformMock: jest.Mock;
  let ngPackagrWithTsConfigMock: jest.Mock;
  let ngCliReadConfigurationMock: jest.Mock;
  let options: BuildAngularLibraryExecutorOptions;

  beforeEach(async () => {
    (
      buildableLibsUtils.calculateProjectBuildableDependencies as jest.Mock
    ).mockImplementation(() => ({
      target: {},
      dependencies: [],
      topLevelDependencies: [],
    }));

    ngPackagrBuildMock = jest.fn(() => Promise.resolve());
    ngPackagerWatchSubject = new BehaviorSubject<void>(undefined);
    ngPackagrWatchMock = jest.fn(() => ngPackagerWatchSubject.asObservable());
    ngPackagrWithBuildTransformMock = jest.fn();
    ngPackagrWithTsConfigMock = jest.fn();
    (ngPackagr.NgPackagr as jest.Mock).mockImplementation(() => ({
      build: ngPackagrBuildMock,
      forProject: jest.fn(),
      watch: ngPackagrWatchMock,
      withBuildTransform: ngPackagrWithBuildTransformMock,
      withTsConfig: ngPackagrWithTsConfigMock,
    }));
    ngCliReadConfigurationMock = jest.fn();
    (ngCompilerCli as jest.Mock).mockImplementation(() => ({
      readConfiguration: ngCliReadConfigurationMock,
    }));

    context = {
      root: '/root',
      projectName: 'my-lib',
      targetName: 'build',
      configurationName: 'production',
      projectsConfigurations: {
        projects: { 'my-lib': { root: '/libs/my-lib' } },
      },
    } as any;
    options = { project: 'my-lib' };
  });

  afterEach(() => jest.clearAllMocks());

  it('should return unsuccessful result when deps have not been built', async () => {
    (
      buildableLibsUtils.checkDependentProjectsHaveBeenBuilt as jest.Mock
    ).mockReturnValue(false);

    const result = await ngPackagrLiteExecutor(options, context).next();

    expect(result.value).toEqual({ success: false });
    expect(result.done).toBe(true);
  });

  it('should build the library when deps have been built', async () => {
    (
      buildableLibsUtils.checkDependentProjectsHaveBeenBuilt as jest.Mock
    ).mockReturnValue(true);

    const result = await ngPackagrLiteExecutor(options, context).next();

    expect(ngPackagrBuildMock).toHaveBeenCalled();
    expect(result.value).toEqual({ success: true });
    expect(result.done).toBe(true);
  });

  it('should instantiate NgPackager with the right providers and set to use the right build transformation provider', async () => {
    (
      buildableLibsUtils.checkDependentProjectsHaveBeenBuilt as jest.Mock
    ).mockReturnValue(true);
    const extraOptions: Partial<BuildAngularLibraryExecutorOptions> = {
      tailwindConfig: 'path/to/tailwind.config.js',
      watch: false,
    };
    const nxProvideOptionsResult = { ...extraOptions, cacheEnabled: true };
    (nxProvideOptions as jest.Mock).mockImplementation(
      () => nxProvideOptionsResult
    );

    const result = await ngPackagrLiteExecutor(
      { ...options, ...extraOptions },
      context
    ).next();

    expect(ngPackagr.NgPackagr).toHaveBeenCalledWith([
      ...NX_PACKAGE_PROVIDERS,
      ...NX_ENTRY_POINT_PROVIDERS,
      nxProvideOptionsResult,
    ]);
    expect(ngPackagrWithBuildTransformMock).toHaveBeenCalledWith(
      NX_PACKAGE_TRANSFORM.provide
    );
    expect(result.value).toEqual({ success: true });
    expect(result.done).toBe(true);
  });

  it('should not set up incremental builds when tsConfig option is not set', async () => {
    (
      buildableLibsUtils.checkDependentProjectsHaveBeenBuilt as jest.Mock
    ).mockReturnValue(true);

    const result = await ngPackagrLiteExecutor(options, context).next();

    expect(buildableLibsUtils.createTmpTsConfig).not.toHaveBeenCalled();
    expect(ngPackagrWithTsConfigMock).not.toHaveBeenCalled();
    expect(ngPackagrBuildMock).toHaveBeenCalled();
    expect(result.value).toEqual({ success: true });
    expect(result.done).toBe(true);
  });

  it('should process tsConfig for incremental builds when tsConfig options is set', async () => {
    // ARRANGE
    (
      buildableLibsUtils.checkDependentProjectsHaveBeenBuilt as jest.Mock
    ).mockReturnValue(true);
    const tsConfig = 'libs/my-lib/tsconfig.lib.json';
    const generatedTsConfig =
      '/root/tmp/libs/my-lib/tsconfig.lib.generated.json';
    (buildableLibsUtils.createTmpTsConfig as jest.Mock).mockImplementation(
      () => generatedTsConfig
    );
    ngCliReadConfigurationMock.mockReturnValue({
      options: { configFilePath: generatedTsConfig },
    });

    // ACT
    const result = await ngPackagrLiteExecutor(
      { ...options, tsConfig },
      context
    ).next();

    // ASSERT
    expect(buildableLibsUtils.createTmpTsConfig).toHaveBeenCalled();
    expect(ngPackagrWithTsConfigMock).toHaveBeenCalledWith({
      options: { configFilePath: `/root/${tsConfig}` },
    });
    expect(ngPackagrBuildMock).toHaveBeenCalled();
    expect(result.value).toEqual({ success: true });
    expect(result.done).toBe(true);
  });

  describe('--watch', () => {
    it('should emit results everytime there are changes', async () => {
      (
        buildableLibsUtils.checkDependentProjectsHaveBeenBuilt as jest.Mock
      ).mockReturnValue(true);

      const results = ngPackagrLiteExecutor(
        { ...options, watch: true },
        context
      );

      ngPackagerWatchSubject.next();
      let changes = 0;
      for await (const result of results) {
        changes++;
        expect(result).toEqual({ success: true });
        if (changes === 2) {
          ngPackagerWatchSubject.complete();
        } else {
          ngPackagerWatchSubject.next();
        }
      }
      expect(ngPackagrWatchMock).toHaveBeenCalledTimes(1);
    });
  });
});
