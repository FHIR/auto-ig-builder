package iger;

import java.io.File;
import java.io.FileDescriptor;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.PrintStream;
import java.lang.ProcessBuilder.Redirect;
import java.net.MalformedURLException;
import java.net.URL;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.nio.file.StandardCopyOption;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;

import javax.xml.bind.DatatypeConverter;

import org.eclipse.jgit.api.Git;
import org.eclipse.jgit.api.errors.GitAPIException;
import org.eclipse.jgit.api.errors.InvalidRemoteException;
import org.eclipse.jgit.api.errors.TransportException;

import com.amazonaws.auth.AWSCredentials;
import com.amazonaws.auth.DefaultAWSCredentialsProviderChain;
import com.amazonaws.services.lambda.runtime.Context;
import com.amazonaws.services.s3.AmazonS3;
import com.amazonaws.services.s3.AmazonS3Client;
import com.amazonaws.services.s3.model.DeleteObjectsRequest;
import com.amazonaws.services.s3.model.DeleteObjectsRequest.KeyVersion;
import com.amazonaws.services.s3.model.ListNextBatchOfObjectsRequest;
import com.amazonaws.services.s3.model.ObjectListing;
import com.amazonaws.services.s3.model.ObjectMetadata;
import com.amazonaws.services.s3.model.PutObjectRequest;
import com.amazonaws.services.s3.model.S3ObjectSummary;

import com.amazonaws.services.sqs.AmazonSQS;
import com.amazonaws.services.sqs.AmazonSQSClient;
import com.amazonaws.services.sqs.model.SendMessageRequest;
import com.amazonaws.services.sqs.model.SendMessageResult;

public class Main {

	private static String FHIR_IG_BUILDER_URL = System.getenv().getOrDefault("FHIR_IG_BUILDER_URL",
			"http://build.fhir.org/org.hl7.fhir.igpublisher.jar");

	private static String QUEUE_URL = System.getenv().getOrDefault("QUEUE_URL",
			"https://sqs.us-east-1.amazonaws.com/515384486676/ig-build-queue");

	private static String BUCKET_URL = System.getenv().getOrDefault("BUCKET_URL", "ig-build.fhir.org");

	public static boolean isCurrent(Map<String, String> adds, String key, String md5) {
		return adds.get(key).equals(md5);
	}

	public static File allOutput ;
	static {
	    try {
			allOutput = Files.createTempFile( String.valueOf(System.currentTimeMillis()), "txt").toFile();
			System.setOut(
					new PrintStream(
							new TeeOutputStream(new FileOutputStream(allOutput.getAbsolutePath(), true),
							new FileOutputStream(FileDescriptor.out)),
							true));
	    } catch (Exception e) { }
	}
	
	public static String build(Req req, Context context) throws Exception {
		String currentTime = LocalDateTime.now().toString();
		
		AWSCredentials creds = new DefaultAWSCredentialsProviderChain().getCredentials();
		AmazonS3 s3 = new AmazonS3Client(creds);
		AmazonSQS sqs = new AmazonSQSClient(creds);
		try {

			if (!req.getService().equals("github.com")) {
				throw new Exception(String.format("Please use a 'github.com' repo, not '%1$s'", req.getService()));
			}

			System.out.println("cleanup");
			run(new File("/tmp"), "/var/task/bin/cleanup.sh");

			String cloneDir = tempDir();
			String outputDir = new File(new File(cloneDir), "output").getAbsolutePath().toString();
			String igPath = String.format("%1$s/%2$s", req.getOrg(), req.getRepo());

			String gitRepoUrl = String.format("https://%1$s/%2$s", req.getService(), igPath);
			File publisherJar = File.createTempFile("lambdatemp-builder", "jar");

			System.out.println("Downloading publisher");
			downloadPublisher(publisherJar);

			System.out.println("Cloning repo " + gitRepoUrl);
			String commit = cloneRepo(cloneDir, gitRepoUrl);

			System.out.println("Building docs");
			buildDocs(publisherJar, cloneDir);

			synchronize(req, outputDir, igPath, s3);

			System.out.println("Uploading debug");
			uploadDebug(req, cloneDir, commit, igPath, s3);

			// TODO: JSON library!
			SendMessageResult enqueued = sqs.sendMessage(new SendMessageRequest(QUEUE_URL,
					String.format(
							"{\"service\": \"%1$s\", \"org\": \"%2$s\", \"repo\": \"%3$s\", \"commit\": \"%4$s\"}",
							req.getService(), req.getOrg(), req.getRepo(), commit)));

			System.out.println(String.format("Enqueued notification: %1$s", enqueued.toString()));

			return "Published to: " + "https://" + BUCKET_URL + "/" + igPath;
		} finally {
			System.out.println("Uploading full logs to S3");
			System.out.flush();
			for (String path : new String[] {
					String.format("logs/%1$s/%2$s/%3$s.log", req.getOrg(), req.getRepo(), currentTime),
					String.format("logs/%1$s/%2$s/latest-build.log", req.getOrg(), req.getRepo())}) {
				ObjectMetadata om = new ObjectMetadata();
				om.setContentType("text/plain");
				PutObjectRequest pr = new PutObjectRequest(BUCKET_URL, path, new FileInputStream(allOutput), om);
				s3.putObject(pr);
			}
		}
	}

	private static void synchronize(Req req, String outputDir, String igPath, AmazonS3 s3) throws IOException {

		Map<String, String> adds = discoverFiles(outputDir);
		List<String> deletes = discoverDeletes(req, igPath, s3, adds);

		System.out.println(String.format("Sync will PUT %1$s and DELETE %2$s objects.", adds.size(), deletes.size()));
		if (deletes.size() > 0) {
			s3.deleteObjects(new DeleteObjectsRequest(BUCKET_URL).withKeys(
					deletes.stream().map(d -> new KeyVersion(igPath + "/" + d)).collect(Collectors.toList())));
		}

		for (String k : adds.keySet()) {
			s3.putObject(BUCKET_URL, igPath + "/" + k, new File(new File(outputDir), k));
		}
	}

	private static void uploadDebug(Req req, String cloneDir, String commit, String igPath, AmazonS3 s3)
			throws IOException, Exception {
		String debugDir = tempDir();
		String debugFilename = commit + ".debug.tgz";
		File debugFile = new File(new File(debugDir), debugFilename);
		run(new File(cloneDir), "tar", "-czf", debugFile.toString(), ".");
		s3.putObject(BUCKET_URL, igPath + "/" + debugFilename, debugFile);
	}

	private static List<String> discoverDeletes(Req req, String igPath, AmazonS3 s3, Map<String, String> adds) {
		List<String> deletes = new ArrayList<String>();

		ObjectListing matches = s3.listObjects(BUCKET_URL, igPath);
		while (true) {
			for (S3ObjectSummary s : matches.getObjectSummaries()) {
				String relativeKey = s.getKey().substring(igPath.length() + 1);
				if (!adds.containsKey(relativeKey)) {
					deletes.add(relativeKey);
				} else if (isCurrent(adds, relativeKey, s.getETag())) {
					adds.remove(relativeKey);
				}
			}
			if (!matches.isTruncated()) {
				break;
			}
			matches = s3.listNextBatchOfObjects(new ListNextBatchOfObjectsRequest(matches));
		}
		return deletes;
	}

	private static Map<String, String> discoverFiles(String outputDir) throws IOException {
		Map<String, String> adds = new HashMap<String, String>();

		Path outputDirPath = Paths.get(outputDir);
		Files.walk(outputDirPath).forEach(p -> {
			if (Files.isDirectory(p)) {
				return;
			}
			try {
				adds.put(outputDirPath.relativize(p).toString(), DatatypeConverter
						.printHexBinary(MessageDigest.getInstance("MD5").digest(Files.readAllBytes(p))).toLowerCase());
			} catch (NoSuchAlgorithmException e) {
				e.printStackTrace();
			} catch (IOException e) {
				e.printStackTrace();
			}
		});
		return adds;
	}

	public static void run(File fromDir, String... args) throws Exception {
		ProcessBuilder p = (new ProcessBuilder()).directory(fromDir).command(args)
				.inheritIO()
				.redirectError(Redirect.appendTo(allOutput))
				.redirectOutput(Redirect.appendTo(allOutput));
		
		p.environment().put("PATH", p.environment().get("PATH").concat(":/var/task/bin:/var/task/ruby/bin"));
		p.start().waitFor();
	}

	public static String tempDir() throws IOException {
		return Files.createTempDirectory("lambdatemp-dir").toAbsolutePath().toString();
	}

	private static void downloadPublisher(File jarFile) throws MalformedURLException, IOException {
		URL website = new URL(FHIR_IG_BUILDER_URL);
		try (InputStream in = website.openStream()) {
			Files.copy(in, jarFile.toPath(), StandardCopyOption.REPLACE_EXISTING);
		}
	}

	private static void buildDocs(File jarFile, String igClone) throws Exception {
		String igJson = new File(igClone, "ig.json").toPath().toAbsolutePath().toString();
		File logFile = new File(new File(System.getProperty("java.io.tmpdir")), "fhir-ig-publisher.log");

		run(new File(igClone), "java", "-jar", jarFile.getAbsolutePath().toString(), "-ig", igJson, "-out", igClone,
				"-auto-ig-build");

		run(new File(igClone), "mv", logFile.getAbsolutePath().toString(), ".");
	}

	private static String cloneRepo(String igClone, String source)
			throws GitAPIException, InvalidRemoteException, TransportException, IOException {
		File igCloneDir = new File(igClone);
		Git.cloneRepository().setURI(source).setDirectory(igCloneDir).call();
		return Git.open(igCloneDir).log().call().iterator().next().getName();
	}

	public static void main(String[] args) throws Exception {
		System.out.println("Starting main");
		Req req = new Req();
		req.setService("github.com");
		req.setOrg("test-igs");
		req.setRepo("daf");
		build(req, null);
		System.out.println("Finishing main");
	}

}
