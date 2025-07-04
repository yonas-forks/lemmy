jest.setTimeout(120000);

import {
  UploadImage,
  PurgePerson,
  PurgePost,
  DeleteImageParams,
} from "lemmy-js-client";
import {
  alpha,
  alphaImage,
  alphaUrl,
  beta,
  betaUrl,
  createCommunity,
  createPost,
  deleteAllMedia,
  epsilon,
  followCommunity,
  gamma,
  imageFetchLimit,
  registerUser,
  resolveBetaCommunity,
  resolveCommunity,
  resolvePost,
  setupLogins,
  waitForPost,
  unfollows,
  getPost,
  waitUntil,
  createPostWithThumbnail,
  sampleImage,
  sampleSite,
  getMyUser,
} from "./shared";

beforeAll(setupLogins);

afterAll(async () => {
  await Promise.allSettled([unfollows(), deleteAllMedia(alpha)]);
});

test("Upload image and delete it", async () => {
  const health = await alpha.imageHealth();
  expect(health.success).toBeTruthy();

  // Upload test image. We use a simple string buffer as pictrs doesn't require an actual image
  // in testing mode.
  const upload_form: UploadImage = {
    image: Buffer.from("test"),
  };
  const upload = await alphaImage.uploadImage(upload_form);
  expect(upload.image_url).toBeDefined();
  expect(upload.filename).toBeDefined();

  // ensure that image download is working. theres probably a better way to do this
  const response = await fetch(upload.image_url ?? "");
  const content = await response.text();
  expect(content.length).toBeGreaterThan(0);

  // Ensure that it comes back with the list_media endpoint
  const listMediaRes = await alphaImage.listMedia();
  expect(listMediaRes.images.length).toBe(1);

  // Ensure that it also comes back with the admin all images
  const listMediaAdminRes = await alpha.listMediaAdmin({
    limit: imageFetchLimit,
  });

  // This number comes from all the previous thumbnails fetched in other tests.
  const previousThumbnails = 1;
  expect(listMediaAdminRes.images.length).toBe(previousThumbnails);

  // Make sure the uploader is correct
  expect(listMediaRes.images[0].person.ap_id).toBe(
    `http://lemmy-alpha:8541/u/lemmy_alpha`,
  );

  // delete image
  const delete_form: DeleteImageParams = {
    filename: upload.filename,
  };
  const delete_ = await alphaImage.deleteMedia(delete_form);
  expect(delete_.success).toBe(true);

  // ensure that image is deleted
  const response2 = await fetch(upload.image_url ?? "");
  const content2 = await response2.text();
  expect(content2).toBe("");

  // Ensure that it shows the image is deleted
  const deletedListMediaRes = await alphaImage.listMedia();
  expect(deletedListMediaRes.images.length).toBe(0);

  // Ensure that the admin shows its deleted
  const deletedListAllMediaRes = await alphaImage.listMediaAdmin({
    limit: imageFetchLimit,
  });
  expect(deletedListAllMediaRes.images.length).toBe(previousThumbnails - 1);
});

test("Purge user, uploaded image removed", async () => {
  let user = await registerUser(alphaImage, alphaUrl);

  // upload test image
  const upload_form: UploadImage = {
    image: Buffer.from("test"),
  };
  const upload = await user.uploadImage(upload_form);
  expect(upload.filename).toBeDefined();
  expect(upload.image_url).toBeDefined();

  // ensure that image download is working. theres probably a better way to do this
  const response = await fetch(upload.image_url ?? "");
  const content = await response.text();
  expect(content.length).toBeGreaterThan(0);

  // purge user
  let my_user = await getMyUser(user);
  const purgeForm: PurgePerson = {
    person_id: my_user.local_user_view.person.id,
  };
  const delete_ = await alphaImage.purgePerson(purgeForm);
  expect(delete_.success).toBe(true);

  // ensure that image is deleted
  const response2 = await fetch(upload.image_url ?? "");
  const content2 = await response2.text();
  expect(content2).toBe("");
});

test("Purge post, linked image removed", async () => {
  let user = await registerUser(beta, betaUrl);

  // upload test image
  const upload_form: UploadImage = {
    image: Buffer.from("test"),
  };
  const upload = await user.uploadImage(upload_form);
  expect(upload.filename).toBeDefined();
  expect(upload.image_url).toBeDefined();

  // ensure that image download is working. theres probably a better way to do this
  const response = await fetch(upload.image_url ?? "");
  const content = await response.text();
  expect(content.length).toBeGreaterThan(0);

  let community = await resolveBetaCommunity(user);
  let post = await createPost(user, community!.community.id, upload.image_url);
  expect(post.post_view.post.url).toBe(upload.image_url);
  expect(post.post_view.image_details).toBeDefined();

  // purge post
  const purgeForm: PurgePost = {
    post_id: post.post_view.post.id,
  };
  const delete_ = await beta.purgePost(purgeForm);
  expect(delete_.success).toBe(true);

  // ensure that image is deleted
  const response2 = await fetch(upload.image_url ?? "");
  const content2 = await response2.text();
  expect(content2).toBe("");
});

test("Images in remote image post are proxied if setting enabled", async () => {
  let community = await createCommunity(gamma);
  let postRes = await createPost(
    gamma,
    community.community_view.community.id,
    sampleImage,
    `![](${sampleImage})`,
  );
  const post = postRes.post_view.post;
  expect(post).toBeDefined();

  // Make sure it fetched the image details
  expect(postRes.post_view.image_details).toBeDefined();

  // remote image gets proxied after upload
  expect(
    post.thumbnail_url?.startsWith(
      "http://lemmy-gamma:8561/api/v4/image/proxy?url",
    ),
  ).toBeTruthy();
  expect(
    post.body?.startsWith("![](http://lemmy-gamma:8561/api/v4/image/proxy?url"),
  ).toBeTruthy();

  // Make sure that it contains `jpg`, to be sure its an image
  expect(post.thumbnail_url?.includes(".jpg")).toBeTruthy();

  let epsilonPostRes = await resolvePost(epsilon, postRes.post_view.post);
  expect(epsilonPostRes?.post).toBeDefined();

  // Fetch the post again, the metadata should be backgrounded now
  // Wait for the metadata to get fetched, since this is backgrounded now
  let epsilonPostRes2 = await waitUntil(
    () => getPost(epsilon, epsilonPostRes!.post.id),
    p => p.post_view.post.thumbnail_url != undefined,
  );
  const epsilonPost = epsilonPostRes2.post_view.post;

  expect(
    epsilonPost.thumbnail_url?.startsWith(
      "http://lemmy-epsilon:8581/api/v4/image/proxy?url",
    ),
  ).toBeTruthy();
  expect(
    epsilonPost.body?.startsWith(
      "![](http://lemmy-epsilon:8581/api/v4/image/proxy?url",
    ),
  ).toBeTruthy();

  // Make sure that it contains `jpg`, to be sure its an image
  expect(epsilonPost.thumbnail_url?.includes(".jpg")).toBeTruthy();
});

test("Thumbnail of remote image link is proxied if setting enabled", async () => {
  let community = await createCommunity(gamma);
  let postRes = await createPost(
    gamma,
    community.community_view.community.id,
    // The sample site metadata thumbnail ends in png
    sampleSite,
  );
  const post = postRes.post_view.post;
  expect(post).toBeDefined();

  // remote image gets proxied after upload
  expect(
    post.thumbnail_url?.startsWith(
      "http://lemmy-gamma:8561/api/v4/image/proxy?url",
    ),
  ).toBeTruthy();

  // Make sure that it contains `png`, to be sure its an image
  expect(post.thumbnail_url?.includes(".png")).toBeTruthy();

  let epsilonPostRes = await resolvePost(epsilon, postRes.post_view.post);
  expect(epsilonPostRes?.post).toBeDefined();

  let epsilonPostRes2 = await waitUntil(
    () => getPost(epsilon, epsilonPostRes!.post.id),
    p => p.post_view.post.thumbnail_url != undefined,
  );
  const epsilonPost = epsilonPostRes2.post_view.post;

  expect(
    epsilonPost.thumbnail_url?.startsWith(
      "http://lemmy-epsilon:8581/api/v4/image/proxy?url",
    ),
  ).toBeTruthy();

  // Make sure that it contains `png`, to be sure its an image
  expect(epsilonPost.thumbnail_url?.includes(".png")).toBeTruthy();
});

test("No image proxying if setting is disabled", async () => {
  let user = await registerUser(beta, betaUrl);
  let community = await createCommunity(alpha);
  let betaCommunity = await resolveCommunity(
    beta,
    community.community_view.community.ap_id,
  );
  await followCommunity(beta, true, betaCommunity!.community.id);

  const upload_form: UploadImage = {
    image: Buffer.from("test"),
  };
  const upload = await user.uploadImage(upload_form);
  let post = await createPost(
    alpha,
    community.community_view.community.id,
    upload.image_url,
    `![](${sampleImage})`,
  );
  expect(post.post_view.post).toBeDefined();

  // remote image doesn't get proxied after upload
  expect(
    post.post_view.post.url?.startsWith("http://lemmy-beta:8551/api/v4/image/"),
  ).toBeTruthy();
  expect(post.post_view.post.body).toBe(`![](${sampleImage})`);

  let betaPost = await waitForPost(beta, post.post_view.post, res => {
    return res?.post.alt_text != null;
  });
  expect(betaPost.post).toBeDefined();

  // remote image doesn't get proxied after federation
  expect(
    betaPost.post.url?.startsWith("http://lemmy-beta:8551/api/v4/image/"),
  ).toBeTruthy();
  expect(betaPost.post.body).toBe(`![](${sampleImage})`);
  // Make sure the alt text got federated
  expect(post.post_view.post.alt_text).toBe(betaPost.post.alt_text);
});

test("Make regular post, and give it a custom thumbnail", async () => {
  const uploadForm1: UploadImage = {
    image: Buffer.from("testRegular1"),
  };
  const upload1 = await alphaImage.uploadImage(uploadForm1);

  const community = await createCommunity(alphaImage);

  // Use wikipedia since it has an opengraph image
  const wikipediaUrl = "https://wikipedia.org/";

  let post = await createPostWithThumbnail(
    alphaImage,
    community.community_view.community.id,
    wikipediaUrl,
    upload1.image_url!,
  );

  // Wait for the metadata to get fetched, since this is backgrounded now
  post = await waitUntil(
    () => getPost(alphaImage, post.post_view.post.id),
    p => p.post_view.post.thumbnail_url != undefined,
  );
  expect(post.post_view.post.url).toBe(wikipediaUrl);
  // Make sure it uses custom thumbnail
  expect(post.post_view.post.thumbnail_url).toBe(upload1.image_url);
});

test("Create an image post, and make sure a custom thumbnail doesn't overwrite it", async () => {
  const uploadForm1: UploadImage = {
    image: Buffer.from("test1"),
  };
  const upload1 = await alphaImage.uploadImage(uploadForm1);

  const uploadForm2: UploadImage = {
    image: Buffer.from("test2"),
  };
  const upload2 = await alphaImage.uploadImage(uploadForm2);

  const community = await createCommunity(alphaImage);

  let post = await createPostWithThumbnail(
    alphaImage,
    community.community_view.community.id,
    upload1.image_url!,
    upload2.image_url!,
  );
  post = await waitUntil(
    () => getPost(alphaImage, post.post_view.post.id),
    p => p.post_view.post.thumbnail_url != undefined,
  );
  expect(post.post_view.post.url).toBe(upload1.image_url);
  // Make sure the custom thumbnail is ignored
  expect(post.post_view.post.thumbnail_url == upload2.image_url).toBe(false);
});
